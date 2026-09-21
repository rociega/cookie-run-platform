import { Router, type IRouter } from "express";
import { eq, and, desc, isNull, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, rentalsTable, agentRunsTable, type Workspace } from "@workspace/db";
import {
  CreateWorkspaceBody,
  ConfirmWorkspaceBody,
  AuthorizeSourceCredentialBody,
  ValidateGitHubRepositoryBody,
} from "@workspace/api-zod";
import {
  PAYMENT_WALLET,
  PAYMENT_CURRENCY,
  COOKIE_PAYMENT_CURRENCY,
  COOKIE_PAYMENT_WALLET,
  COOKIE_CHAIN_RPC_URL,
  SOLANA_RPC_URL,
  COOKIE_QUOTE_TTL_MS,
  COOKIE_SOL_PREMIUM_MULTIPLIER,
  isCookiePaymentConfigured,
  SOLANA_NETWORK,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_PAYMENT_WALLET,
  ROBINHOOD_RPC_URL,
  ROBINHOOD_QUOTE_TTL_MS,
  ROBINHOOD_TOKEN_CONTRACT,
  ROBINHOOD_TOKEN_DECIMALS,
  ICPX_TOKEN_MINT,
  ICPX_TOKEN_DECIMALS,
  MAX_EXTRA_DISK_GB,
  isPaymentConfigured,
  isRobinhoodPaymentConfigured,
  isRobinhoodTokenPaymentConfigured,
  tokenLockReason,
  isTokenLive,
  isVastConfigured,
} from "../lib/config";
import {
  getCheapestOffer,
  getInstances,
  type VastInstanceDetail,
} from "../lib/vast";
import {
  findTemplate,
  resolveTemplate,
  computePriceBreakdown,
  listPublicTemplates,
  isValidInstanceType,
} from "../lib/templates";
import {
  getSolUsd,
  getCookUsd,
  getIcpxUsd,
  deriveTokenAccount,
  formatTokenAmount,
  getTransactionFeePayer,
  LAMPORTS_PER_SOL,
} from "../lib/solana";
import {
  ETH_NETWORK_FEE_USD,
  EVM_PAYMENT_CHAIN,
  formatEthAmount,
  getEthUsd,
  getFrSqrtPriceX96,
  quoteEthBaseUnits,
  quoteFrBaseUnits,
} from "../lib/robinhood";
import {
  verifyWorkspacePayment,
  provisionWorkspace,
  notifyWorkspaceSettled,
  claimSignatureAndSettle,
} from "../lib/settlement";
import {
  requireAuth,
  currentAccount,
  isEthereumAddress,
  normalizeWalletAddress,
  walletColumnEquals,
  walletIdentitiesMatch,
  normalizeWalletForStorage,
} from "../lib/walletAuth";
import { requireAnyAccountAuth } from "../lib/apiKeys";
import { mintWorkspaceTerminalTicket } from "../lib/terminalTickets";
import {
  checkSourceRateLimit,
  normalizeGitHubRepositoryUrl,
  recordSourceProtectionEvent,
  SourceRateLimitStoreError,
  validateGitHubRepository,
} from "../lib/source-control";
import { validateContainerImage } from "../lib/container-image";
import {
  attachSourceCredential,
  authorizeSourceCredential,
  getSourceCredential,
} from "../lib/source-credentials";

const router: IRouter = Router();

// Creates the (1:1) agent_runs row for a freshly created rental when the
// client asked for an Agent Run. Provisioning (settlement.ts) picks this up
// by rentalId once payment clears and generates the run's ephemeral SSH
// credential at that point, not here.
async function insertAgentRunIfRequested(
  rentalId: number,
  task: string | null,
  repositoryUrl: string | null,
  repositoryRevision: string | null,
  payerWallet: string | null,
): Promise<void> {
  if (!task || !repositoryUrl) return;
  await db.insert(agentRunsTable).values({
    rentalId,
    task,
    repositoryUrl,
    repositoryRevision,
    payerWallet,
    status: "queued",
  });
}

function sourceClientId(req: {
  ip?: string;
  socket: { remoteAddress?: string };
}): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function respondToSourceRateLimit(
  res: {
    setHeader(name: string, value: string): void;
    status(code: number): { json(body: unknown): void };
  },
  retryAfterSeconds: number,
  body: unknown,
): void {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json(body);
}

const SOURCE_RATE_LIMIT_STORE_RETRY_AFTER_SECONDS = 5;

function respondToSourceRateLimitStoreUnavailable(
  res: {
    setHeader(name: string, value: string): void;
    status(code: number): { json(body: unknown): void };
  },
  body: unknown,
): void {
  res.setHeader(
    "Retry-After",
    String(SOURCE_RATE_LIMIT_STORE_RETRY_AFTER_SECONDS),
  );
  res.status(503).json(body);
}

function serializeWorkspace(r: Workspace) {
  return {
    id: r.id,
    gpuModel: r.gpuModel,
    durationHours: r.durationHours,
    templateId: r.templateId,
    repositoryUrl: r.repositoryUrl,
    repositoryRevision: r.repositoryRevision,
    containerImage: r.containerImage,
    instanceType: r.instanceType,
    extraDiskGb: r.extraDiskGb,
    priceUsd: r.priceUsd,
    solAmount: r.solAmount,
    lamports: r.expectedLamports,
    currency: r.currency,
    paymentChain: r.paymentChain,
    chainId: r.chainId,
    amountBaseUnits: r.amountBaseUnits,
    ethAmount: r.ethAmount,
    tokenContract: r.tokenContract,
    assetDecimals: r.assetDecimals,
    quoteExpiresAt: r.quoteExpiresAt?.toISOString() ?? null,
    priceBeforeDiscountUsd: r.priceBeforeDiscountUsd,
    discountUsd: r.discountUsd,
    tokenDiscountBps: r.tokenDiscountBps,
    destination: r.destination,
    tokenMint: r.tokenMint,
    tokenAmount: r.tokenAmount,
    expectedTokenAmount: r.expectedTokenAmount,
    tokenDestination: r.tokenDestination,
    paymentReference: r.paymentReference,
    payerWallet: r.payerWallet,
    paymentStatus: r.paymentStatus,
    paymentTxSignature: r.paymentTxSignature,
    vastInstanceId: r.vastInstanceId,
    status: r.status,
    email: r.email,
    createdAt: r.createdAt.toISOString(),
  };
}

// Public, unauthenticated GET /workspaces/:id uses guessable sequential ids, so it
// must not leak buyer PII. Omit payerWallet, email, and the tx signature; keep
// only what an order-status poll legitimately needs.
function serializeWorkspacePublic(r: Workspace) {
  return {
    id: r.id,
    gpuModel: r.gpuModel,
    durationHours: r.durationHours,
    templateId: r.templateId,
    repositoryUrl: r.repositoryUrl,
    repositoryRevision: r.repositoryRevision,
    containerImage: r.containerImage,
    instanceType: r.instanceType,
    extraDiskGb: r.extraDiskGb,
    priceUsd: r.priceUsd,
    solAmount: r.solAmount,
    lamports: r.expectedLamports,
    currency: r.currency,
    paymentChain: r.paymentChain,
    chainId: r.chainId,
    amountBaseUnits: r.amountBaseUnits,
    ethAmount: r.ethAmount,
    tokenContract: r.tokenContract,
    assetDecimals: r.assetDecimals,
    quoteExpiresAt: r.quoteExpiresAt?.toISOString() ?? null,
    priceBeforeDiscountUsd: r.priceBeforeDiscountUsd,
    discountUsd: r.discountUsd,
    tokenDiscountBps: r.tokenDiscountBps,
    destination: r.destination,
    tokenMint: r.tokenMint,
    tokenAmount: r.tokenAmount,
    expectedTokenAmount: r.expectedTokenAmount,
    tokenDestination: r.tokenDestination,
    paymentReference: r.paymentReference,
    paymentStatus: r.paymentStatus,
    vastInstanceId: r.vastInstanceId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

// POST /workspaces/:id/confirm is unauthenticated and ids are sequential, so an
// attacker could enumerate it with a junk signature to harvest buyer PII. Only
// return the full owner shape to a caller who can present the matching on-chain
// signature; everyone else gets the PII-free public shape. The legitimate payer
// always holds the real signature, so their success flow is unaffected.
function serializeWorkspaceConfirm(r: Workspace, signature: string) {
  return r.paymentTxSignature && signature === r.paymentTxSignature
    ? serializeWorkspace(r)
    : serializeWorkspacePublic(r);
}

router.get("/payment-config", (_req, res): void => {
  const paymentReady = isCookiePaymentConfigured();
  const solPaymentReady = isPaymentConfigured();
  res.json({
    destination: paymentReady ? COOKIE_PAYMENT_WALLET : "",
    network: "cookie-chain",
    currency: COOKIE_PAYMENT_CURRENCY,
    tokenLive: isTokenLive(),
    tokenMint: ICPX_TOKEN_MINT || null,
    tokenDecimals: ICPX_TOKEN_DECIMALS,
    paymentReady,
    solPaymentReady,
    solPremiumMultiplier: COOKIE_SOL_PREMIUM_MULTIPLIER,
    chainId: null,
    tokenReady: false,
    tokenLockReason: "Token checkout is not enabled on Cookie Chain.",
    evmPaymentWallet: null,
    rpcUrl: COOKIE_CHAIN_RPC_URL,
  });
});

// Public catalog of compute workload presets. Returns the PII-free/internal-free
// projection (no Docker image or onstart script) so provisioning details never
// reach the client.
router.get("/templates", (_req, res): void => {
  res.json(listPublicTemplates());
});

router.post("/source-control/credentials/authorize", async (req, res): Promise<void> => {
  const parsed = AuthorizeSourceCredentialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid source credential." });
    return;
  }
  let rateLimit;
  try {
    rateLimit = await checkSourceRateLimit(
      sourceClientId(req),
      "source-credential-authorization",
    );
  } catch (err) {
    if (err instanceof SourceRateLimitStoreError) {
      respondToSourceRateLimitStoreUnavailable(res, {
        status: "error",
        message: "Credential authorization is temporarily unavailable. Try again shortly.",
      });
      return;
    }
    throw err;
  }
  if (!rateLimit.allowed) {
    recordSourceProtectionEvent({
      endpoint: "credential-authorization",
      actor: "api_limiter",
      reason: "rate_limit",
    });
    respondToSourceRateLimit(
      res,
      rateLimit.retryAfterSeconds,
      {
        status: "error",
        message: "Too many credential authorization attempts. Try again shortly.",
      },
    );
    return;
  }
  const result = await authorizeSourceCredential({
    provider: parsed.data.provider,
    token: parsed.data.token,
    username: parsed.data.username,
    registryHost: parsed.data.registryHost,
  });
  // Rejected credentials are a normal UI state, not an exceptional server
  // failure. Returning the status payload lets the checkout distinguish
  // permission_denied from expired without exposing the token.
  res.status(200).json(result);
});

router.post("/source-control/github/validate", async (req, res): Promise<void> => {
  const parsed = ValidateGitHubRepositoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a GitHub repository URL." });
    return;
  }

  try {
    const credential = getSourceCredential(parsed.data.credentialRef, "github");
    if (parsed.data.credentialRef && !credential) {
      res.json({
        status: "expired",
        repositoryUrl: null,
        revision: null,
        defaultBranch: null,
        repositoryName: null,
        message: "The GitHub connection expired. Authorize it again.",
      });
      return;
    }
    let rateLimit;
    try {
      rateLimit = await checkSourceRateLimit(
        sourceClientId(req),
        "github-repository-validation",
      );
    } catch (err) {
      if (err instanceof SourceRateLimitStoreError) {
        respondToSourceRateLimitStoreUnavailable(res, {
          error: "Source checks are temporarily unavailable. Try again shortly.",
        });
        return;
      }
      throw err;
    }
    if (!rateLimit.allowed) {
      recordSourceProtectionEvent({
        endpoint: "github-validation",
        actor: "api_limiter",
        reason: "rate_limit",
      });
      respondToSourceRateLimit(
        res,
        rateLimit.retryAfterSeconds,
        { error: "Too many source checks. Try again shortly." },
      );
      return;
    }
    const result = await validateGitHubRepository({
      ...parsed.data,
      accessToken: credential?.token,
    });
    res.json({
      status: result.status,
      repositoryUrl: result.repositoryUrl ?? null,
      revision: result.revision ?? null,
      defaultBranch: result.status === "connected" ? result.defaultBranch : null,
      repositoryName: result.status === "connected" ? result.repositoryName : null,
      message: result.message,
    });
  } catch (err) {
    if (err instanceof SourceRateLimitStoreError) {
      respondToSourceRateLimitStoreUnavailable(res, {
        error: "Source checks are temporarily unavailable. Try again shortly.",
      });
      return;
    }
    const message =
      err instanceof Error ? err.message : "GitHub repository validation failed.";
    res.status(400).json({ error: message });
  }
});

// /rentals remains a compatibility alias for existing clients and records.
// New clients use /workspaces.
router.post(["/workspaces", "/rentals"], async (req, res): Promise<void> => {
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid workspace request" });
    return;
  }
  const {
    gpuModel,
    durationHours,
    email,
    payerWallet,
    sshKey,
    repositoryUrl: requestedRepositoryUrl,
    repositoryRevision: requestedRepositoryRevision,
    githubCredentialRef,
    registryCredentialRef,
    agentTask,
  } = parsed.data;
  // EVM providers may return checksum-cased addresses. Keep Solana's
  // case-sensitive base58 identity untouched, while making new EVM rows
  // canonical so future ownership reads are index-friendly.
  const storedPayerWallet = normalizeWalletForStorage(payerWallet);
  const currency = parsed.data.currency ?? COOKIE_PAYMENT_CURRENCY;
  if (
     (currency === COOKIE_PAYMENT_CURRENCY || currency === "SOL") &&
    (!storedPayerWallet ||
      isEthereumAddress(storedPayerWallet) ||
      normalizeWalletAddress(storedPayerWallet) !== storedPayerWallet)
  ) {
    res.status(400).json({ error: "Connect a valid Cookie Chain wallet before requesting a COOK quote" });
    return;
  }
  if (currency === COOKIE_PAYMENT_CURRENCY && !isCookiePaymentConfigured()) {
    res.status(503).json({
      error: "COOK payments on Cookie Chain are not configured yet",
    });
    return;
  }
  if (currency === "SOL" && !isPaymentConfigured()) {
    res.status(503).json({ error: "SOL payments on Solana are not configured yet" });
    return;
  }
  if (currency === "ETH" && !isRobinhoodPaymentConfigured()) {
    res.status(503).json({ error: "ETH payments on Robinhood Chain are not configured yet" });
    return;
  }
  if (currency === "ICPX" && !isPaymentConfigured()) {
    res.status(503).json({ error: "Legacy Solana payments are not configured" });
    return;
  }
  if (currency === "TOKEN") {
    if (!isRobinhoodTokenPaymentConfigured()) {
      res.status(503).json({ error: tokenLockReason() });
      return;
    }
  }
  if (currency === "TOKEN" && !isRobinhoodPaymentConfigured()) {
    res.status(503).json({ error: "FR payments on Robinhood Chain are not configured yet" });
    return;
  }
  if (!isVastConfigured()) {
    res.status(503).json({ error: "GPU provider is not configured yet" });
    return;
  }

  let repositoryUrl: string | null = null;
  let repositoryRevision: string | null = null;
  try {
    const containerImage = validateContainerImage(parsed.data.containerImage);
    if (requestedRepositoryUrl?.trim()) {
      const rateLimit = await checkSourceRateLimit(
        sourceClientId(req),
        "github-repository-validation",
      );
      if (!rateLimit.allowed) {
        recordSourceProtectionEvent({
          endpoint: "workspace-create",
          actor: "api_limiter",
          reason: "rate_limit",
        });
        respondToSourceRateLimit(
          res,
          rateLimit.retryAfterSeconds,
          { error: "Too many source checks. Try again shortly." },
        );
        return;
      }
      const source = await validateGitHubRepository({
        repositoryUrl: requestedRepositoryUrl,
        revision: requestedRepositoryRevision,
        accessToken: getSourceCredential(githubCredentialRef, "github")?.token,
      });
      if (source.status === "permission_required") {
        res.status(403).json({ error: source.message });
        return;
      }
      if (source.status !== "connected") {
        res.status(503).json({ error: source.message });
        return;
      }
      repositoryUrl = normalizeGitHubRepositoryUrl(source.repositoryUrl);
      repositoryRevision = source.revision;
    }
    parsed.data.containerImage = containerImage ?? undefined;
    if (githubCredentialRef && !getSourceCredential(githubCredentialRef, "github")) {
      res.status(403).json({ error: "The GitHub connection expired. Authorize it again." });
      return;
    }
    if (registryCredentialRef && !getSourceCredential(registryCredentialRef, "registry")) {
      res.status(403).json({ error: "The registry connection expired. Authorize it again." });
      return;
    }
  } catch (err) {
    if (err instanceof SourceRateLimitStoreError) {
      respondToSourceRateLimitStoreUnavailable(res, {
        error: "Source checks are temporarily unavailable. Try again shortly.",
      });
      return;
    }
    const message =
      err instanceof Error ? err.message : "Invalid workspace workflow input";
    res.status(400).json({ error: message });
    return;
  }

  if (currency === "ICPX" && !isTokenLive()) {
    res.status(503).json({ error: "ICPX payments are not available yet" });
    return;
  }

  const agentTaskTrimmed = agentTask?.trim() || null;
  if (agentTaskTrimmed) {
    if (!repositoryUrl) {
      res.status(400).json({ error: "An Agent Run needs a public GitHub repository." });
      return;
    }
    if (githubCredentialRef) {
      // Private-repo access is not built yet (see the source connections
      // task); an Agent Run only ever gets a repository it could already
      // validate as public.
      res.status(400).json({
        error: "Agent Run currently supports public GitHub repositories only.",
      });
      return;
    }
  }

  // Validate the compute selection against the trusted catalog. An unknown
  // template id is rejected rather than silently defaulted so the workspace owner never
  // pays for a workload other than the one they picked.
  const templateId = parsed.data.templateId ?? null;
  if (templateId && !findTemplate(templateId)) {
    res.status(400).json({ error: "Unknown compute template" });
    return;
  }
  const template = resolveTemplate(templateId);

  const instanceType = parsed.data.instanceType ?? "on-demand";
  if (!isValidInstanceType(instanceType)) {
    res.status(400).json({ error: "Unknown instance type" });
    return;
  }

  const extraDiskGb = parsed.data.extraDiskGb ?? 0;
  if (!Number.isInteger(extraDiskGb) || extraDiskGb < 0 || extraDiskGb > MAX_EXTRA_DISK_GB) {
    res.status(400).json({ error: `Extra disk must be a whole number between 0 and ${MAX_EXTRA_DISK_GB} GB` });
    return;
  }

  let offer;
  try {
    offer = await getCheapestOffer(gpuModel);
  } catch (err) {
    req.log.error({ err }, "vast offer lookup failed");
    res.status(503).json({ error: "Unable to reach the GPU provider" });
    return;
  }
  if (!offer) {
    res.status(503).json({ error: `No ${gpuModel} capacity available right now` });
    return;
  }

  const breakdown = computePriceBreakdown({
    dphTotal: offer.dphTotal,
    durationHours,
    template,
    instanceType,
    extraDiskGb,
  });
  const priceUsdNum = breakdown.totalUsd;

  if (currency === "ETH") {
    let ethUsd: string;
    try {
      ethUsd = await getEthUsd();
    } catch (err) {
      req.log.error({ err }, "eth price fetch failed");
      res.status(503).json({ error: "Unable to fetch a live ETH price" });
      return;
    }
    const ethChargeUsdNum = priceUsdNum + ETH_NETWORK_FEE_USD;
    const amountBaseUnits = quoteEthBaseUnits(ethChargeUsdNum.toFixed(4), ethUsd);
    const [row] = await db
      .insert(rentalsTable)
      .values({
        gpuModel,
        durationHours,
        templateId,
        repositoryUrl,
        repositoryRevision,
        containerImage: parsed.data.containerImage ?? null,
        instanceType,
        extraDiskGb,
        priceUsd: priceUsdNum.toFixed(4),
        solAmount: "0",
        expectedLamports: "0",
        currency: "ETH",
        paymentChain: EVM_PAYMENT_CHAIN,
        chainId: ROBINHOOD_CHAIN_ID,
        amountBaseUnits: amountBaseUnits.toString(),
        ethAmount: formatEthAmount(amountBaseUnits),
        quoteExpiresAt: new Date(Date.now() + ROBINHOOD_QUOTE_TTL_MS),
        destination: ROBINHOOD_PAYMENT_WALLET,
        paymentReference: randomUUID(),
         payerWallet: storedPayerWallet,
        vastOfferId: String(offer.id),
        email: email ?? null,
        sshKey: sshKey ?? null,
      })
      .returning();

    await insertAgentRunIfRequested(row.id, agentTaskTrimmed, repositoryUrl, repositoryRevision, storedPayerWallet);
    req.log.info({ id: row.id, gpuModel, currency: "ETH", amountBaseUnits: amountBaseUnits.toString() }, "workspace created");
    if (
      (githubCredentialRef && !attachSourceCredential(githubCredentialRef, "github", row.id)) ||
      (registryCredentialRef && !attachSourceCredential(registryCredentialRef, "registry", row.id))
    ) {
      res.status(409).json({ error: "The source connection was already used. Authorize it again." });
      return;
    }
    res.status(201).json({
      ...serializeWorkspace(row),
      priceBreakdown: breakdown,
      ethNetworkFeeUsd: ETH_NETWORK_FEE_USD,
    });
    return;
  }

  if (currency === "TOKEN") {
    let amountBaseUnits: bigint;
    try {
      const [ethUsd, sqrtPriceX96] = await Promise.all([getEthUsd(), getFrSqrtPriceX96()]);
      amountBaseUnits = quoteFrBaseUnits(priceUsdNum.toFixed(4), ethUsd, sqrtPriceX96);
    } catch (err) {
      req.log.error({ err }, "fr price fetch failed");
      res.status(503).json({ error: "Unable to fetch a live FR price" });
      return;
    }
    if (amountBaseUnits <= 0n) {
      res.status(503).json({ error: "Unable to quote an FR amount right now" });
      return;
    }
    const [row] = await db.insert(rentalsTable).values({
      gpuModel, durationHours, templateId, repositoryUrl, repositoryRevision,
      containerImage: parsed.data.containerImage ?? null, instanceType, extraDiskGb,
      priceUsd: priceUsdNum.toFixed(4), solAmount: "0", expectedLamports: "0",
      currency: "TOKEN", paymentChain: EVM_PAYMENT_CHAIN, chainId: ROBINHOOD_CHAIN_ID,
      amountBaseUnits: amountBaseUnits.toString(), tokenContract: ROBINHOOD_TOKEN_CONTRACT,
      assetDecimals: Number(ROBINHOOD_TOKEN_DECIMALS), quoteExpiresAt: new Date(Date.now() + ROBINHOOD_QUOTE_TTL_MS),
      destination: ROBINHOOD_PAYMENT_WALLET, paymentReference: randomUUID(), payerWallet: storedPayerWallet,
      vastOfferId: String(offer.id), email: email ?? null, sshKey: sshKey ?? null,
    }).returning();
    await insertAgentRunIfRequested(row.id, agentTaskTrimmed, repositoryUrl, repositoryRevision, storedPayerWallet);
    res.status(201).json({ ...serializeWorkspace(row), priceBreakdown: breakdown });
    return;
  }

  // $ICPX checkout: quote the locked token amount from a live price, derive the
  // operator's ATA so the buyer knows exactly where to send, and store both
  // expected raw base units (for verification) and a human display amount. SOL
  // amount fields are zeroed — the currency column selects the path at confirm.
  if (currency === "ICPX") {
    let icpxUsd: number;
    try {
      icpxUsd = await getIcpxUsd(ICPX_TOKEN_MINT);
    } catch (err) {
      req.log.error({ err }, "icpx price fetch failed");
      res.status(503).json({ error: "Unable to fetch a live ICPX price" });
      return;
    }
    const tokenAmountNum = priceUsdNum / icpxUsd;
    const expectedRaw = BigInt(
      Math.ceil(tokenAmountNum * 10 ** ICPX_TOKEN_DECIMALS),
    );
    if (expectedRaw <= 0n) {
      req.log.error({ icpxUsd, priceUsdNum }, "icpx quote produced zero amount");
      res.status(503).json({ error: "Unable to quote an ICPX amount right now" });
      return;
    }
    const tokenDestination = deriveTokenAccount(PAYMENT_WALLET, ICPX_TOKEN_MINT);

    const [row] = await db
      .insert(rentalsTable)
      .values({
        gpuModel,
        durationHours,
        templateId,
        repositoryUrl,
        repositoryRevision,
        containerImage: parsed.data.containerImage ?? null,
        instanceType,
        extraDiskGb,
        priceUsd: priceUsdNum.toFixed(4),
        solAmount: "0",
        expectedLamports: "0",
        currency: "ICPX",
        destination: PAYMENT_WALLET,
        tokenMint: ICPX_TOKEN_MINT,
        expectedTokenAmount: expectedRaw.toString(),
        tokenAmount: formatTokenAmount(expectedRaw, ICPX_TOKEN_DECIMALS),
        tokenDestination,
        paymentReference: randomUUID(),
         payerWallet: storedPayerWallet,
        vastOfferId: String(offer.id),
        email: email ?? null,
        sshKey: sshKey ?? null,
      })
      .returning();

    await insertAgentRunIfRequested(row.id, agentTaskTrimmed, repositoryUrl, repositoryRevision, storedPayerWallet);
    req.log.info(
      {
        id: row.id,
        gpuModel,
        currency: "ICPX",
        expectedTokenAmount: expectedRaw.toString(),
      },
      "workspace created",
    );
    if (
      (githubCredentialRef &&
        !attachSourceCredential(githubCredentialRef, "github", row.id)) ||
      (registryCredentialRef &&
        !attachSourceCredential(registryCredentialRef, "registry", row.id))
    ) {
      res.status(409).json({ error: "The source connection was already used. Authorize it again." });
      return;
    }
    res.status(201).json({ ...serializeWorkspace(row), priceBreakdown: breakdown });
    return;
  }

  if (currency === "SOL") {
    let solUsd: number;
    try {
      solUsd = await getSolUsd();
    } catch (err) {
      req.log.error({ err }, "sol price fetch failed");
      res.status(503).json({ error: "Unable to fetch a live SOL price" });
      return;
    }
    const solChargeUsdNum = priceUsdNum * COOKIE_SOL_PREMIUM_MULTIPLIER;
    const solAmountNum = solChargeUsdNum / solUsd;
    const lamports = BigInt(Math.ceil(solAmountNum * Number(LAMPORTS_PER_SOL)));
    const [row] = await db.insert(rentalsTable).values({
      gpuModel, durationHours, templateId, repositoryUrl, repositoryRevision,
      containerImage: parsed.data.containerImage ?? null, instanceType, extraDiskGb,
      priceUsd: solChargeUsdNum.toFixed(4), solAmount: solAmountNum.toFixed(9),
      expectedLamports: lamports.toString(), currency: "SOL",
      paymentChain: "solana", quoteExpiresAt: new Date(Date.now() + COOKIE_QUOTE_TTL_MS),
      destination: PAYMENT_WALLET, paymentReference: randomUUID(),
      payerWallet: storedPayerWallet, vastOfferId: String(offer.id),
      email: email ?? null, sshKey: sshKey ?? null,
    }).returning();
    await insertAgentRunIfRequested(row.id, agentTaskTrimmed, repositoryUrl, repositoryRevision, storedPayerWallet);
    res.status(201).json({
      ...serializeWorkspace(row),
      priceBreakdown: breakdown,
      paymentPremiumMultiplier: COOKIE_SOL_PREMIUM_MULTIPLIER,
    });
    return;
  }

  if (currency !== COOKIE_PAYMENT_CURRENCY) {
    res.status(400).json({ error: "That payment currency is no longer available for new orders" });
    return;
  }

  let cookUsd: number;
  try {
    cookUsd = await getCookUsd();
  } catch (err) {
    req.log.error({ err }, "cook price fetch failed");
    res.status(503).json({ error: "Unable to fetch a live COOK price" });
    return;
  }

  const cookAmountNum = priceUsdNum / cookUsd;
  const lamports = BigInt(Math.ceil(cookAmountNum * Number(LAMPORTS_PER_SOL)));

  const [row] = await db
    .insert(rentalsTable)
    .values({
      gpuModel,
      durationHours,
      templateId,
      repositoryUrl,
      repositoryRevision,
      containerImage: parsed.data.containerImage ?? null,
      instanceType,
      extraDiskGb,
      priceUsd: priceUsdNum.toFixed(4),
      solAmount: cookAmountNum.toFixed(9),
      expectedLamports: lamports.toString(),
      currency: COOKIE_PAYMENT_CURRENCY,
      paymentChain: "cookie-chain",
      quoteExpiresAt: new Date(Date.now() + COOKIE_QUOTE_TTL_MS),
      destination: COOKIE_PAYMENT_WALLET,
      paymentReference: randomUUID(),
       payerWallet: storedPayerWallet,
      vastOfferId: String(offer.id),
      email: email ?? null,
      sshKey: sshKey ?? null,
    })
    .returning();

  await insertAgentRunIfRequested(row.id, agentTaskTrimmed, repositoryUrl, repositoryRevision, storedPayerWallet);
  req.log.info(
    { id: row.id, gpuModel, currency: COOKIE_PAYMENT_CURRENCY, lamports: lamports.toString() },
    "workspace created",
  );
  if (
    (githubCredentialRef &&
      !attachSourceCredential(githubCredentialRef, "github", row.id)) ||
    (registryCredentialRef &&
      !attachSourceCredential(registryCredentialRef, "registry", row.id))
  ) {
    res.status(409).json({ error: "The source connection was already used. Authorize it again." });
    return;
  }
  res.status(201).json({ ...serializeWorkspace(row), priceBreakdown: breakdown });
});

// Authenticated: list the signed-in wallet's paid workspaces, each enriched with
// live Vast connection details. Gated behind sign-in-with-wallet because SSH
// host/port are sensitive — without proof of wallet ownership anyone could
// enumerate them. Only paymentStatus='paid' rows are returned, so unpaid quotes
// (whose payerWallet is untrusted client input) can never surface in another
// wallet's list.
router.get(["/workspaces", "/rentals"], requireAnyAccountAuth, async (req, res): Promise<void> => {
  const wallet = currentAccount(res).walletAddress;

  // Adopt legacy paid workspaces that predate persisting the on-chain payer: they
  // are paid + signed but have a NULL payerWallet, so they'd never surface in
  // anyone's list. Re-derive the fee payer from the (already-verified) payment
  // signature; if it matches the signed-in wallet, attribute the workspace to them.
  // Ownership is PROVEN on-chain, never asserted. Self-healing (the orphan set is
  // fixed — every new confirm stores the payer) and fail-soft (an RPC outage just
  // delays visibility instead of 500ing the whole list).
  try {
    const orphans = await db
      .select()
      .from(rentalsTable)
      .where(
        and(
          eq(rentalsTable.paymentStatus, "paid"),
          isNull(rentalsTable.payerWallet),
          isNotNull(rentalsTable.paymentTxSignature),
        ),
      )
      .limit(10);

    await Promise.allSettled(
      orphans.map(async (o) => {
        if (!o.paymentTxSignature) return;
        const payer = await getTransactionFeePayer(o.paymentTxSignature);
        if (payer !== wallet) return;
        await db
          .update(rentalsTable)
          .set({ payerWallet: wallet })
          .where(
            and(eq(rentalsTable.id, o.id), isNull(rentalsTable.payerWallet)),
          );
      }),
    );
  } catch (err) {
    req.log.warn({ err }, "legacy workspace adoption skipped");
  }

  const rows = await db
    .select()
    .from(rentalsTable)
    .where(and(walletColumnEquals(rentalsTable.payerWallet, wallet), eq(rentalsTable.paymentStatus, "paid")))
    .orderBy(desc(rentalsTable.createdAt));

  // Single bulk call, merged by instance id. Fail-soft: if Vast is slow or down
  // we still return the workspaces from the DB without live connection details.
  const instanceMap = new Map<string, VastInstanceDetail>();
  try {
    for (const inst of await getInstances()) instanceMap.set(inst.id, inst);
  } catch (err) {
    req.log.warn({ err }, "provider enrichment failed; serving workspaces without live details");
  }

  const workspaces = rows.map((r) => ({
    ...serializeWorkspace(r),
    instance: r.vastInstanceId ? (instanceMap.get(r.vastInstanceId) ?? null) : null,
  }));

  // This response contains wallet ownership and live connection details. Do
  // not let a browser/proxy reuse one wallet's body for another wallet simply
  // because both requests share the generated URL.
  res.setHeader("Cache-Control", "private, no-store");
  res.json(workspaces);
});

// Mint a one-time, short-lived ticket that authorizes a single WebSocket
// terminal upgrade. Authed + ownership-checked here because the WS upgrade
// bypasses Express middleware. The ticket is bound to {workspaceId, wallet}; the
// client passes it as ?ticket=... on the wss URL. Never put the bearer token in
// the URL — a ticket is single-use and expires within a minute.
router.post(
  ["/workspaces/:id/terminal-ticket", "/rentals/:id/terminal-ticket"],
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const wallet = currentAccount(res).walletAddress;

    const [rental] = await db
      .select()
      .from(rentalsTable)
      .where(eq(rentalsTable.id, id))
      .limit(1);

    if (!rental || !walletIdentitiesMatch(rental.payerWallet, wallet)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (rental.paymentStatus !== "paid") {
      res.status(409).json({ error: "This workspace has not been paid for yet." });
      return;
    }
    if (!rental.vastInstanceId) {
      res.status(409).json({
        error: "The instance is still provisioning — try again shortly.",
      });
      return;
    }

    const { ticket, expiresInSeconds } = mintWorkspaceTerminalTicket(id, wallet);
    res.json({ ticket, expiresInSeconds });
  },
);

router.get(["/workspaces/:id", "/rentals/:id"], async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .select()
    .from(rentalsTable)
    .where(eq(rentalsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeWorkspacePublic(row));
});

router.post(
  ["/workspaces/:id/confirm", "/rentals/:id/confirm"],
  async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = ConfirmWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid transaction signature is required" });
    return;
  }
  const { signature } = parsed.data;

  const [rental] = await db
    .select()
    .from(rentalsTable)
    .where(eq(rentalsTable.id, id))
    .limit(1);
  if (!rental) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Already settled and provisioned — idempotent success.
  if (rental.paymentStatus === "paid" && rental.vastInstanceId) {
    res.json(serializeWorkspaceConfirm(rental, signature));
    return;
  }

  let justPaid = false;

  if (rental.paymentStatus !== "paid") {
    const verification = await verifyWorkspacePayment(rental, signature);
    if (!verification.ok) {
      // Safety net: if the tx simply hasn't confirmed yet (the client persists
      // the signature the moment it broadcasts, before confirmation completes),
      // record it so a paid-but-unconfirmed workspace is never lost if the owner
      // gives up or closes the tab. Stored on a NON-unique column that is never
      // used for dup/replay/PII checks, so a public on-chain signature can't be
      // POSTed here to squat the order. Only stamp orders still pending without
      // a verified signature.
      if (verification.reason === "Transaction not found or not yet confirmed") {
        await db
          .update(rentalsTable)
          .set({ submittedTxSignature: signature })
          .where(
            and(
              eq(rentalsTable.id, id),
              eq(rentalsTable.paymentStatus, "pending"),
              isNull(rentalsTable.paymentTxSignature),
            ),
          );
      } else {
        req.log.warn({ id, reason: verification.reason }, "payment verification failed");
      }
      res.status(400).json({ error: verification.reason ?? "Payment verification failed" });
      return;
    }

    // Claim the signature system-wide (single-use across BOTH workspaces and
    // marketplace purchases) and flip pending -> paid in one transaction, so a
    // payment can't settle two orders and concurrent confirms can't double-provision.
    const outcome = await claimSignatureAndSettle(
      signature,
      { kind: "rental", id },
      (tx) =>
        tx
          .update(rentalsTable)
          .set({
            paymentStatus: "paid",
            paymentTxSignature: signature,
            status: "provisioning",
            // Bind the workspace to the on-chain payer (derived from the tx, not
            // trusted client input) so the owning wallet can list it.
            payerWallet:
              normalizeWalletForStorage(verification.payer) ??
              normalizeWalletForStorage(rental.payerWallet),
          })
          .where(
            and(
              eq(rentalsTable.id, id),
              eq(rentalsTable.paymentStatus, "pending"),
            ),
          )
          .returning()
          .then((rows) => rows[0]),
    );

    if (outcome.status === "conflict") {
      res.status(400).json({ error: "This payment was already used" });
      return;
    }
    // "settled": we won the claim. "already_settled": a concurrent confirm won —
    // fall through to (idempotent) provisioning with the current state.
    if (outcome.status === "settled") justPaid = true;
  }

  // Provision now — first attempt, or a retry if a prior attempt failed and
  // left the order in "provisioning" with no instance. Shared with the
  // background reconciler so the two paths can never diverge.
  const [paidRow] = await db
    .select()
    .from(rentalsTable)
    .where(eq(rentalsTable.id, id))
    .limit(1);

  const updated = await provisionWorkspace(paidRow, req.log);

  if (justPaid) {
    notifyWorkspaceSettled(updated, req.log);
  }

  res.json(serializeWorkspaceConfirm(updated, signature));
  },
);

export default router;
