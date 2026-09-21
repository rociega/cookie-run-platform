// Shared payment-settlement primitives used by BOTH the interactive confirm
// routes and the background reconciliation job. Centralizing them here means the
// security-critical verification path, the Vast provisioning loop, and the
// post-settlement side effects can never diverge between the two callers.
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import {
  db,
  rentalsTable,
  purchasesTable,
  consumedPaymentSignaturesTable,
  agentRunsTable,
  type Workspace,
  type Purchase,
} from "@workspace/db";
import {
  COOKIE_PAYMENT_CURRENCY,
  COOKIE_PAYMENT_WALLET,
  PAYMENT_WALLET,
  ICPX_QUOTE_TTL_MS,
  INSTANCE_TYPE_MULTIPLIER,
} from "./config";
import {
  verifyPayment,
  verifySolPayment,
  verifyTokenPayment,
  deriveTokenAccount,
} from "./solana";
import {
  EVM_PAYMENT_CHAIN,
  evmClaimKey,
  verifyRobinhoodNativePayment,
  verifyRobinhoodTokenPayment,
} from "./robinhood";
import { resolveTemplate } from "./templates";
import { getMatchingOffers, createInstance } from "./vast";
import {
  buildSourceBootstrap,
  validateGitHubRepository,
} from "./source-control";
import {
  getSourceCredentialsForRental,
  releaseSourceCredentialsForRental,
} from "./source-credentials";
import { buildRegistryImageLogin } from "./container-image";
import { composeOnstartCommands } from "./provisioning";
import {
  sendEmail,
  notifyAdmin,
  rentalConfirmationEmail,
  esc,
} from "./email";
import { creditFirstRentalByWallet } from "./rewards";
import { generateAgentSshKeypair, combineSshKeys } from "./agentSsh";
import { runAgentTask } from "./agentRunner";

export interface PaymentCheck {
  ok: boolean;
  reason?: string;
  payer?: string;
}

function rejectNetworkMismatch(
  currency: string,
  paymentChain: string | null | undefined,
): PaymentCheck | null {
  if (currency === COOKIE_PAYMENT_CURRENCY && paymentChain !== "cookie-chain") {
    return { ok: false, reason: "COOK payments must use Cookie Chain" };
  }
  if (currency === "SOL" && paymentChain !== "solana") {
    return { ok: false, reason: "SOL payments must use Solana mainnet" };
  }
  return null;
}

export async function verifyWorkspacePayment(
  rental: Workspace,
  signature: string,
): Promise<PaymentCheck> {
  const networkMismatch = rejectNetworkMismatch(rental.currency, rental.paymentChain);
  if (networkMismatch) return networkMismatch;
  if (rental.currency === "TOKEN") {
    if (!rental.amountBaseUnits || !rental.tokenContract) return { ok: false, reason: "Workspace is missing FR payment details" };
    return verifyRobinhoodTokenPayment({ hash: signature, destination: rental.destination, amountBaseUnits: rental.amountBaseUnits, reference: rental.paymentReference, quoteExpiresAt: rental.quoteExpiresAt, expectedPayer: rental.payerWallet, tokenContract: rental.tokenContract });
  }
  if (rental.paymentChain === EVM_PAYMENT_CHAIN || rental.currency === "ETH") {
    if (!rental.amountBaseUnits) {
      return { ok: false, reason: "Workspace is missing ETH payment details" };
    }
    return verifyRobinhoodNativePayment({
      hash: signature,
      destination: rental.destination,
      amountBaseUnits: rental.amountBaseUnits,
      reference: rental.paymentReference,
      quoteExpiresAt: rental.quoteExpiresAt,
      expectedPayer: rental.payerWallet,
    });
  }
  if (rental.currency === "ICPX") {
    if (!rental.tokenMint || !rental.expectedTokenAmount) {
      return { ok: false, reason: "Workspace is missing ICPX payment details" };
    }
    const operatorAta = deriveTokenAccount(PAYMENT_WALLET, rental.tokenMint);
    return verifyTokenPayment(
      signature,
      operatorAta,
      rental.tokenMint,
      PAYMENT_WALLET,
      BigInt(rental.expectedTokenAmount),
      {
        reference: rental.paymentReference,
        quoteCreatedAtMs: rental.createdAt.getTime(),
        maxQuoteAgeMs: ICPX_QUOTE_TTL_MS,
      },
    );
  }
  if (rental.currency === "SOL" || rental.paymentChain === "solana") {
    return verifySolPayment(
      signature,
      rental.destination || PAYMENT_WALLET,
      BigInt(rental.expectedLamports),
      { reference: rental.paymentReference, expectedPayer: rental.payerWallet },
    );
  }
  return verifyPayment(
    signature,
    rental.destination,
    BigInt(rental.expectedLamports),
    { reference: rental.paymentReference, expectedPayer: rental.payerWallet },
  );
}
export async function verifyPurchasePayment(
  purchase: Purchase,
  signature: string,
): Promise<PaymentCheck> {
  const networkMismatch = rejectNetworkMismatch(purchase.currency, purchase.paymentChain);
  if (networkMismatch) return networkMismatch;
  if (purchase.paymentChain === EVM_PAYMENT_CHAIN || purchase.currency === "ETH") {
    if (!purchase.amountBaseUnits) {
      return { ok: false, reason: "Purchase is missing ETH payment details" };
    }
    return verifyRobinhoodNativePayment({
      hash: signature,
      destination: purchase.destination ?? PAYMENT_WALLET,
      amountBaseUnits: purchase.amountBaseUnits,
      reference: purchase.paymentReference,
      quoteExpiresAt: purchase.quoteExpiresAt,
      expectedPayer: purchase.payerWallet,
    });
  }
  if (purchase.currency === "ICPX") {
    if (!purchase.tokenMint || !purchase.expectedTokenAmount) {
      return { ok: false, reason: "Purchase is missing ICPX payment details" };
    }
    const operatorAta = deriveTokenAccount(PAYMENT_WALLET, purchase.tokenMint);
    return verifyTokenPayment(
      signature,
      operatorAta,
      purchase.tokenMint,
      PAYMENT_WALLET,
      BigInt(purchase.expectedTokenAmount),
      {
        reference: purchase.paymentReference,
        quoteCreatedAtMs: purchase.createdAt.getTime(),
        maxQuoteAgeMs: ICPX_QUOTE_TTL_MS,
      },
    );
  }
  if (purchase.currency === "SOL" || purchase.paymentChain === "solana") {
    return verifySolPayment(
      signature,
      purchase.destination ?? PAYMENT_WALLET,
      BigInt(purchase.expectedLamports),
      { reference: purchase.paymentReference, expectedPayer: purchase.payerWallet },
    );
  }
  if (purchase.currency === COOKIE_PAYMENT_CURRENCY && !purchase.destination) {
    return { ok: false, reason: "Purchase is missing its Cookie Chain payment destination" };
  }
  return verifyPayment(
    signature,
    purchase.destination ??
      (purchase.currency === COOKIE_PAYMENT_CURRENCY
        ? COOKIE_PAYMENT_WALLET
        : PAYMENT_WALLET),
    BigInt(purchase.expectedLamports),
    { reference: purchase.paymentReference, expectedPayer: purchase.payerWallet },
  );
}

// The transaction handle passed to a db.transaction(...) callback.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SettleOutcome<T> =
  | { status: "settled"; row: T } // this call won the claim and flipped pending -> paid
  | { status: "already_settled" } // the order was no longer pending (idempotent)
  | { status: "conflict" }; // the signature already settled a DIFFERENT order (replay)

// The single, system-wide payment-claim primitive. Every settlement path (both
// confirm routes and both reconciler loops) MUST settle through this so the
// single-use guarantee can never drift between paths.
//
// Why a dedicated table instead of an application-level "is it used?" check: a
// read-then-write check is TOCTOU — two concurrent confirms (e.g. one workspace and
// one purchase referencing the SAME on-chain tx) can both pass the read before
// either writes, then each persists the signature into its own table (the per-
// table unique columns are independent and don't block cross-table reuse). The
// `consumed_payment_signatures` table has a single PK on `signature`, so the
// `INSERT ... ON CONFLICT DO NOTHING` below is the one atomic serialization point:
// exactly one concurrent caller inserts the row; all others get zero rows back.
//
// The claim and the order's pending -> paid flip run in ONE transaction so they
// commit together. `flip` must be a conditional UPDATE (... WHERE payment_status
// = 'pending') returning the updated row (or undefined if no longer pending).
// Callers MUST verify the payment on-chain BEFORE calling this, so an invalid
// payment never consumes a signature.
export async function claimSignatureAndSettle<T>(
  signature: string,
  order: { kind: "rental" | "purchase"; id: number },
  flip: (tx: DbTransaction) => Promise<T | undefined>,
): Promise<SettleOutcome<T>> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(consumedPaymentSignaturesTable)
      .values({ signature, orderKind: order.kind, orderId: order.id })
      .onConflictDoNothing({ target: consumedPaymentSignaturesTable.signature })
      .returning({ signature: consumedPaymentSignaturesTable.signature });

    if (inserted.length === 0) {
      // Already claimed. Allow ONLY the same order to proceed (idempotent retry /
      // reconciler self-heal after a crash between claim and flip); any other
      // order trying to reuse this signature is a replay.
      const [owner] = await tx
        .select({
          orderKind: consumedPaymentSignaturesTable.orderKind,
          orderId: consumedPaymentSignaturesTable.orderId,
        })
        .from(consumedPaymentSignaturesTable)
        .where(eq(consumedPaymentSignaturesTable.signature, signature))
        .limit(1);
      const isSelf =
        !!owner &&
        owner.orderKind === order.kind &&
        owner.orderId === order.id;
      if (!isSelf) return { status: "conflict" as const };
    }

    const row = await flip(tx);
    return row
      ? { status: "settled" as const, row }
      : { status: "already_settled" as const };
  });
}

// Solana signatures remain exactly as stored for historical claims. EVM hashes
// are namespaced by chain so identical text can never collide across chains.
export function paymentClaimKey(
  paymentChain: string | null,
  signature: string,
): string {
  return paymentChain === EVM_PAYMENT_CHAIN ? evmClaimKey(signature) : signature;
}

export async function provisionWorkspace(
  rental: Workspace,
  log: Logger,
): Promise<Workspace> {
  if (!rental.vastInstanceId) {
    try {
      const candidates = await getMatchingOffers(rental.gpuModel, 3);
      if (candidates.length === 0) {
        throw new Error("No offer available to provision");
      }
      const template = resolveTemplate(rental.templateId);
      const diskGb = template.defaultDiskGb + (rental.extraDiskGb ?? 0);
      const sourceCredentials = getSourceCredentialsForRental(rental.id);

      // An Agent Run needs the SERVER to be able to SSH in on its own, so it
      // gets its own ephemeral keypair registered alongside whatever key the
      // renter pasted. See agentSsh.ts for why the private half never touches
      // the database.
      const [agentRun] = await db
        .select({ id: agentRunsTable.id, status: agentRunsTable.status })
        .from(agentRunsTable)
        .where(eq(agentRunsTable.rentalId, rental.id))
        .limit(1);
      let effectiveSshKey = rental.sshKey;
      if (agentRun && agentRun.status === "queued") {
        const { publicKey } = await generateAgentSshKeypair(rental.id);
        effectiveSshKey = combineSshKeys(rental.sshKey, publicKey);
      }
      let sourceBootstrap: string | null = null;
      if (rental.repositoryUrl && rental.repositoryRevision) {
        const source = await validateGitHubRepository({
          repositoryUrl: rental.repositoryUrl,
          revision: rental.repositoryRevision,
          accessToken: sourceCredentials.github?.token,
        });
        if (source.status !== "connected") {
          throw new Error(
            source.message ||
              "The repository is not accessible with the current source connection.",
          );
        }
        sourceBootstrap = buildSourceBootstrap(
          rental.repositoryUrl,
          rental.repositoryRevision,
          sourceCredentials.github ? "FORGERUN_GITHUB_TOKEN" : undefined,
        );
      }
      // Bootstrap source before a template's process starts. Some templates
      // intentionally run a foreground server, so appending the checkout
      // after it would leave the repository uninitialized forever.
      const onstart = composeOnstartCommands(sourceBootstrap, template.onstart);

      let lastErr: unknown;
      let provisioned = false;
      for (const candidate of candidates) {
        try {
          const instance = await createInstance(
            candidate.id,
            `forgerun-workspace-${rental.id}`,
            {
              sshKey: effectiveSshKey,
              image: rental.containerImage ?? template.image,
              onstart: onstart || null,
              env: sourceCredentials.github
                ? { FORGERUN_GITHUB_TOKEN: sourceCredentials.github.token }
                : undefined,
              imageLogin: sourceCredentials.registry
                ? buildRegistryImageLogin(
                    rental.containerImage ?? template.image,
                    sourceCredentials.registry,
                  )
                : null,
              diskGb,
              port: template.accessType === "http" ? template.accessPort : null,
              // Spot provisions as an interruptible bid. Bid the spot fraction of
              // the candidate's market rate so our cost tracks the discounted price
              // we charged — bidding full market rate would sell spot below cost.
              bidPrice:
                rental.instanceType === "spot"
                  ? candidate.dphTotal * (INSTANCE_TYPE_MULTIPLIER.spot ?? 0.6)
                  : null,
            },
          );
          await db
            .update(rentalsTable)
            .set({
              vastInstanceId: instance.instanceId,
              vastOfferId: String(candidate.id),
              status: "active",
            })
            .where(eq(rentalsTable.id, rental.id));
          provisioned = true;
          releaseSourceCredentialsForRental(rental.id);
          if (agentRun && agentRun.status === "queued") {
            runAgentTask(rental.id, instance.instanceId);
          }
          break;
        } catch (err) {
          log.warn(
            { err, offerId: candidate.id, workspaceId: rental.id },
            "workspace provisioning attempt failed, trying next offer",
          );
          lastErr = err;
        }
      }
      if (!provisioned) throw lastErr;
    } catch (err) {
      log.error(
        { err, workspaceId: rental.id },
        "workspace provisioning failed after payment captured",
      );
      // Payment is captured; status stays "provisioning" for a later retry.
    }
  }

  const [updated] = await db
    .select()
    .from(rentalsTable)
    .where(eq(rentalsTable.id, rental.id))
    .limit(1);
  return updated;
}
export function notifyWorkspaceSettled(rental: Workspace, log: Logger): void {
  if (rental.email) {
    void sendEmail({
      to: rental.email,
      subject: "Your ForgeRun workspace is confirmed",
      html: rentalConfirmationEmail({
        id: rental.id,
        gpuModel: rental.gpuModel,
        durationHours: rental.durationHours,
        priceUsd: rental.priceUsd,
        solAmount: rental.solAmount,
        currency: rental.currency,
        tokenAmount: rental.tokenAmount,
        vastInstanceId: rental.vastInstanceId,
        status: rental.status,
      }),
    });
  }
  const paidLabel =
    rental.currency === "ETH"
      ? `${rental.ethAmount ?? "0"} ETH`
      : rental.currency === "ICPX"
        ? `${rental.tokenAmount ?? "0"} ICPX`
        : rental.currency === COOKIE_PAYMENT_CURRENCY
          ? `${rental.solAmount} COOK`
        : `${rental.solAmount} SOL`;
  void notifyAdmin(
    "New ForgeRun workspace (paid)",
    `<p>Workspace #${rental.id} · ${esc(rental.gpuModel)} · ${rental.durationHours}h</p>
       <p>Paid: ${paidLabel} ($${rental.priceUsd})</p>
       <p>Instance: ${esc(rental.vastInstanceId ?? "PENDING")} · Status: ${esc(rental.status)}</p>
       <p>Payer: <code>${esc(rental.payerWallet ?? "unknown")}</code></p>`,
  );
  void creditFirstRentalByWallet(rental.payerWallet).catch((err) => {
    log.error({ err, workspaceId: rental.id }, "first_workspace credit failed");
  });
}

/** @deprecated Use notifyWorkspaceSettled. */
export const notifyRentalSettled = notifyWorkspaceSettled;

/** @deprecated Use verifyWorkspacePayment. */
export const verifyRentalPayment = verifyWorkspacePayment;

/** @deprecated Use provisionWorkspace. */
export const provisionRental = provisionWorkspace;
