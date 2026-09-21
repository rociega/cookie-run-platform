import { Router, type IRouter } from "express";
import { eq, and, or, desc, ilike, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  listingsTable,
  purchasesTable,
  rewardAccountsTable,
  reviewsTable,
} from "@workspace/db";
import {
  CreateListingBody,
  UpdateListingBody,
  CreatePurchaseBody,
  ConfirmPurchaseBody,
  CreateReviewBody,
} from "@workspace/api-zod";
import {
  PAYMENT_WALLET,
  PAYMENT_CURRENCY,
  COOKIE_PAYMENT_CURRENCY,
  COOKIE_PAYMENT_WALLET,
  COOKIE_SOL_PREMIUM_MULTIPLIER,
  COOKIE_QUOTE_TTL_MS,
  isCookiePaymentConfigured,
  ICPX_TOKEN_MINT,
  ICPX_TOKEN_DECIMALS,
  MARKETPLACE_MIN_PRICE_USD,
  MARKETPLACE_MAX_PRICE_USD,
  isPaymentConfigured,
  isRobinhoodPaymentConfigured,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_PAYMENT_WALLET,
  ROBINHOOD_QUOTE_TTL_MS,
  tokenLockReason,
  isTokenLive,
} from "../lib/config";
import {
  getSolUsd,
  getCookUsd,
  getIcpxUsd,
  deriveTokenAccount,
  formatTokenAmount,
  LAMPORTS_PER_SOL,
} from "../lib/solana";
import {
  ETH_NETWORK_FEE_USD,
  EVM_PAYMENT_CHAIN,
  formatEthAmount,
  getEthUsd,
  quoteEthBaseUnits,
} from "../lib/robinhood";
import { findTemplate } from "../lib/templates";
import {
  requireAuth,
  currentAccount,
  isEthereumAddress,
  normalizeWalletAddress,
  normalizeWalletForStorage,
} from "../lib/walletAuth";
import {
  serializeListing,
  serializeListingPublic,
  serializePurchase,
  serializeReview,
  toRatingAggregate,
  creditSeller,
  isListingCategory,
} from "../lib/marketplace";
import { isUniqueViolation } from "../lib/rewards";
import {
  verifyPurchasePayment,
  claimSignatureAndSettle,
} from "../lib/settlement";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();

const DOWNLOAD_TTL_SECONDS = 300;

const REVIEW_BODY_MAX = 2000;

// Grouped review aggregate (avg rating + count per listing) as a subquery, left
// joined into the public listing reads so Browse and the detail view show a star
// average + review count in a single query. avg() comes back as a numeric string
// and count() as a string — normalized via toRatingAggregate().
function reviewAggregateSubquery() {
  return db
    .select({
      listingId: reviewsTable.listingId,
      avg: sql<string | null>`avg(${reviewsTable.rating})`.as("avg_rating"),
      count: sql<string>`count(*)`.as("review_count"),
    })
    .from(reviewsTable)
    .groupBy(reviewsTable.listingId)
    .as("review_agg");
}

// ---------------------------------------------------------------------------
// Browse / search (public, PII-safe)
// ---------------------------------------------------------------------------
router.get("/marketplace/listings", async (req, res): Promise<void> => {
  const conds = [eq(listingsTable.status, "active")];

  const category = typeof req.query.category === "string" ? req.query.category : null;
  if (category) {
    if (!isListingCategory(category)) {
      res.status(400).json({ error: "Unknown category" });
      return;
    }
    conds.push(eq(listingsTable.category, category));
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (q) {
    const like = `%${q}%`;
    const search = or(ilike(listingsTable.title, like), ilike(listingsTable.description, like));
    if (search) conds.push(search);
  }

  const agg = reviewAggregateSubquery();
  const rows = await db
    .select({
      listing: listingsTable,
      walletAddress: rewardAccountsTable.walletAddress,
      handle: rewardAccountsTable.handle,
      avg: agg.avg,
      count: agg.count,
    })
    .from(listingsTable)
    .innerJoin(rewardAccountsTable, eq(listingsTable.sellerAccountId, rewardAccountsTable.id))
    .leftJoin(agg, eq(listingsTable.id, agg.listingId))
    .where(and(...conds))
    .orderBy(desc(listingsTable.createdAt))
    .limit(100);

  res.json(
    rows.map((r) =>
      serializeListingPublic(
        r.listing,
        { walletAddress: r.walletAddress, handle: r.handle },
        toRatingAggregate({ avg: r.avg, count: r.count }),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// Create draft listing (authed)
// ---------------------------------------------------------------------------
router.post("/marketplace/listings", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid listing" });
    return;
  }
  const seller = currentAccount(res);
  const { title, description, category, priceUsd, fileName, fileSizeBytes, suggestedTemplateId } =
    parsed.data;

  if (!isListingCategory(category)) {
    res.status(400).json({ error: "Unknown category" });
    return;
  }
  if (!Number.isFinite(priceUsd) || priceUsd < MARKETPLACE_MIN_PRICE_USD || priceUsd > MARKETPLACE_MAX_PRICE_USD) {
    res.status(400).json({
      error: `Price must be between $${MARKETPLACE_MIN_PRICE_USD} and $${MARKETPLACE_MAX_PRICE_USD}`,
    });
    return;
  }
  // Validate the optional rental bridge against the trusted catalog so a buyer
  // can only ever be deep-linked into a real compute template.
  if (suggestedTemplateId && !findTemplate(suggestedTemplateId)) {
    res.status(400).json({ error: "Unknown compute template" });
    return;
  }

  const [row] = await db
    .insert(listingsTable)
    .values({
      sellerAccountId: seller.id,
      title,
      description: description ?? "",
      category,
      priceUsd: priceUsd.toFixed(4),
      fileName: fileName ?? null,
      fileSizeBytes: fileSizeBytes != null ? String(fileSizeBytes) : null,
      suggestedTemplateId: suggestedTemplateId ?? null,
    })
    .returning();

  req.log.info({ id: row.id, category, sellerAccountId: seller.id }, "listing created (draft)");
  res.status(201).json(serializeListing(row));
});

// ---------------------------------------------------------------------------
// Seller's own listings (authed; includes drafts)
// ---------------------------------------------------------------------------
router.get("/marketplace/my-listings", requireAuth, async (req, res): Promise<void> => {
  const seller = currentAccount(res);
  res.setHeader("Cache-Control", "private, no-store");
  const rows = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.sellerAccountId, seller.id))
    .orderBy(desc(listingsTable.createdAt));
  res.json(rows.map(serializeListing));
});

// ---------------------------------------------------------------------------
// Get one active listing (public)
// ---------------------------------------------------------------------------
router.get("/marketplace/listings/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const agg = reviewAggregateSubquery();
  const [row] = await db
    .select({
      listing: listingsTable,
      walletAddress: rewardAccountsTable.walletAddress,
      handle: rewardAccountsTable.handle,
      avg: agg.avg,
      count: agg.count,
    })
    .from(listingsTable)
    .innerJoin(rewardAccountsTable, eq(listingsTable.sellerAccountId, rewardAccountsTable.id))
    .leftJoin(agg, eq(listingsTable.id, agg.listingId))
    .where(and(eq(listingsTable.id, id), eq(listingsTable.status, "active")))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(
    serializeListingPublic(
      row.listing,
      { walletAddress: row.walletAddress, handle: row.handle },
      toRatingAggregate({ avg: row.avg, count: row.count }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Edit a listing's title/description/price/category (authed, owner only)
// ---------------------------------------------------------------------------
router.patch("/marketplace/listings/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = UpdateListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid listing" });
    return;
  }
  const seller = currentAccount(res);

  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, id))
    .limit(1);
  // 404 (not 403) on a non-owner so listing ids can't be enumerated.
  if (!listing || listing.sellerAccountId !== seller.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (listing.status === "removed") {
    res.status(400).json({ error: "This listing has been removed" });
    return;
  }

  const { title, description, category, priceUsd } = parsed.data;

  if (category !== undefined && !isListingCategory(category)) {
    res.status(400).json({ error: "Unknown category" });
    return;
  }
  if (
    priceUsd !== undefined &&
    (!Number.isFinite(priceUsd) ||
      priceUsd < MARKETPLACE_MIN_PRICE_USD ||
      priceUsd > MARKETPLACE_MAX_PRICE_USD)
  ) {
    res.status(400).json({
      error: `Price must be between $${MARKETPLACE_MIN_PRICE_USD} and $${MARKETPLACE_MAX_PRICE_USD}`,
    });
    return;
  }

  const updates: Partial<typeof listingsTable.$inferInsert> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (priceUsd !== undefined) updates.priceUsd = priceUsd.toFixed(4);

  if (Object.keys(updates).length === 0) {
    res.json(serializeListing(listing));
    return;
  }

  const [updated] = await db
    .update(listingsTable)
    .set(updates)
    .where(eq(listingsTable.id, id))
    .returning();

  req.log.info({ id, sellerAccountId: seller.id }, "listing updated");
  res.json(serializeListing(updated));
});

// ---------------------------------------------------------------------------
// Remove (deactivate) a listing (authed, owner only)
// ---------------------------------------------------------------------------
// Soft-remove: flip status to "removed" so it leaves Browse but the row (and its
// object_path) survives, keeping existing purchases' downloads working.
router.delete("/marketplace/listings/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const seller = currentAccount(res);

  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, id))
    .limit(1);
  if (!listing || listing.sellerAccountId !== seller.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Idempotent: already removed -> return current state.
  if (listing.status === "removed") {
    res.json(serializeListing(listing));
    return;
  }

  const [updated] = await db
    .update(listingsTable)
    .set({ status: "removed" })
    .where(eq(listingsTable.id, id))
    .returning();

  req.log.info({ id, sellerAccountId: seller.id }, "listing removed");
  res.json(serializeListing(updated));
});

// ---------------------------------------------------------------------------
// Request a presigned upload URL (authed, owner only)
// ---------------------------------------------------------------------------
router.post(
  "/marketplace/listings/:id/upload-grant",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const seller = currentAccount(res);
    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, id))
      .limit(1);
    if (!listing || listing.sellerAccountId !== seller.id) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const svc = new ObjectStorageService();
    let uploadURL: string;
    let objectPath: string;
    try {
      uploadURL = await svc.getObjectEntityUploadURL();
      objectPath = svc.normalizeObjectEntityPath(uploadURL);
    } catch (err) {
      req.log.error({ err, id }, "upload url signing failed");
      res.status(503).json({ error: "Unable to start an upload right now" });
      return;
    }

    // Bind the (not-yet-uploaded) object path to the listing now so finalize can
    // verify it without trusting any client-supplied path. The path is never
    // returned to the client.
    await db.update(listingsTable).set({ objectPath }).where(eq(listingsTable.id, id));
    res.json({ uploadURL });
  },
);

// ---------------------------------------------------------------------------
// Finalize: verify the uploaded object exists and activate the listing (authed)
// ---------------------------------------------------------------------------
router.post(
  "/marketplace/listings/:id/finalize",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const seller = currentAccount(res);
    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, id))
      .limit(1);
    if (!listing || listing.sellerAccountId !== seller.id) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!listing.objectPath) {
      res.status(400).json({ error: "Upload a file before finalizing" });
      return;
    }

    const svc = new ObjectStorageService();
    let fileSizeBytes = listing.fileSizeBytes;
    try {
      const file = await svc.getObjectEntityFile(listing.objectPath);
      const [metadata] = await file.getMetadata();
      // Overwrite the client-declared size with the authoritative GCS metadata.
      if (metadata.size != null) fileSizeBytes = String(metadata.size);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "No uploaded file found — upload again" });
        return;
      }
      req.log.error({ err, id }, "finalize object lookup failed");
      res.status(503).json({ error: "Unable to verify the upload right now" });
      return;
    }

    const [updated] = await db
      .update(listingsTable)
      .set({ status: "active", fileSizeBytes })
      .where(eq(listingsTable.id, id))
      .returning();

    req.log.info({ id, sellerAccountId: seller.id }, "listing activated");
    res.json(serializeListing(updated));
  },
);

// ---------------------------------------------------------------------------
// Create a purchase order + payment quote (authed)
// ---------------------------------------------------------------------------
router.post(
  "/marketplace/listings/:id/purchase",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = CreatePurchaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid purchase request" });
      return;
    }
    const buyer = currentAccount(res);

    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, id))
      .limit(1);
    if (!listing || listing.status !== "active") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (listing.sellerAccountId === buyer.id) {
      res.status(400).json({ error: "You can't buy your own listing" });
      return;
    }

     const currency = parsed.data.currency ?? COOKIE_PAYMENT_CURRENCY;
     if (currency === COOKIE_PAYMENT_CURRENCY && !isCookiePaymentConfigured()) {
       res.status(503).json({ error: "COOK payments on Cookie Chain are not configured yet" });
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
      res.status(503).json({ error: tokenLockReason() });
      return;
    }
    if (currency === "ICPX" && !isTokenLive()) {
      res.status(503).json({ error: "ICPX payments are not available yet" });
      return;
    }
    const payerWallet = normalizeWalletForStorage(parsed.data.payerWallet);
    if (
       (currency === COOKIE_PAYMENT_CURRENCY || currency === "SOL") &&
      (!payerWallet ||
        isEthereumAddress(payerWallet) ||
        normalizeWalletAddress(payerWallet) !== payerWallet)
    ) {
      res.status(400).json({ error: "Connect a valid Cookie Chain wallet before requesting a COOK quote" });
      return;
    }
    const priceUsdNum = Number(listing.priceUsd);

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
        .insert(purchasesTable)
        .values({
          listingId: listing.id,
          buyerAccountId: buyer.id,
          priceUsd: listing.priceUsd,
          solAmount: "0",
          expectedLamports: "0",
          currency: "ETH",
          destination: ROBINHOOD_PAYMENT_WALLET,
          paymentChain: EVM_PAYMENT_CHAIN,
          chainId: ROBINHOOD_CHAIN_ID,
          amountBaseUnits: amountBaseUnits.toString(),
          ethAmount: formatEthAmount(amountBaseUnits),
          quoteExpiresAt: new Date(Date.now() + ROBINHOOD_QUOTE_TTL_MS),
          paymentReference: randomUUID(),
          payerWallet,
        })
        .returning();

      req.log.info(
        { id: row.id, listingId: listing.id, currency: "ETH", amountBaseUnits: amountBaseUnits.toString() },
        "purchase created",
      );
      res.status(201).json({
        ...serializePurchase(row, listing),
        ethNetworkFeeUsd: ETH_NETWORK_FEE_USD,
      });
      return;
    }

    // $ICPX checkout: quote the locked token amount from a live price and derive
    // the operator's ATA. SOL amount fields are zeroed — the currency column
    // selects the verification path at confirm. Mirrors the rentals flow.
    if (currency === "ICPX") {
      let icpxUsd: number;
      try {
        icpxUsd = await getIcpxUsd(ICPX_TOKEN_MINT);
      } catch (err) {
        req.log.error({ err }, "icpx price fetch failed");
        res.status(503).json({ error: "Unable to fetch a live ICPX price" });
        return;
      }
      const expectedRaw = BigInt(Math.ceil((priceUsdNum / icpxUsd) * 10 ** ICPX_TOKEN_DECIMALS));
      if (expectedRaw <= 0n) {
        req.log.error({ icpxUsd, priceUsdNum }, "icpx quote produced zero amount");
        res.status(503).json({ error: "Unable to quote an ICPX amount right now" });
        return;
      }
      const tokenDestination = deriveTokenAccount(PAYMENT_WALLET, ICPX_TOKEN_MINT);

      const [row] = await db
        .insert(purchasesTable)
        .values({
          listingId: listing.id,
          buyerAccountId: buyer.id,
          priceUsd: listing.priceUsd,
          solAmount: "0",
          expectedLamports: "0",
          currency: "ICPX",
          destination: PAYMENT_WALLET,
          tokenMint: ICPX_TOKEN_MINT,
          expectedTokenAmount: expectedRaw.toString(),
          tokenAmount: formatTokenAmount(expectedRaw, ICPX_TOKEN_DECIMALS),
          tokenDestination,
          paymentReference: randomUUID(),
          payerWallet,
        })
        .returning();

      req.log.info({ id: row.id, listingId: listing.id, currency: "ICPX" }, "purchase created");
      res.status(201).json(serializePurchase(row, listing));
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
      const [row] = await db.insert(purchasesTable).values({
        listingId: listing.id,
        buyerAccountId: buyer.id,
        priceUsd: solChargeUsdNum.toFixed(4),
        solAmount: solAmountNum.toFixed(9),
        expectedLamports: lamports.toString(),
        currency: "SOL",
        paymentChain: "solana",
        quoteExpiresAt: new Date(Date.now() + COOKIE_QUOTE_TTL_MS),
        destination: PAYMENT_WALLET,
        paymentReference: randomUUID(),
        payerWallet,
      }).returning();
      req.log.info({ id: row.id, listingId: listing.id, currency: "SOL", lamports: lamports.toString() }, "purchase created");
      res.status(201).json({
        ...serializePurchase(row, listing),
        paymentPremiumMultiplier: COOKIE_SOL_PREMIUM_MULTIPLIER,
      });
      return;
    }
    if (currency !== COOKIE_PAYMENT_CURRENCY) {
      res.status(400).json({ error: "That payment currency is no longer available for new purchases" });
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
      .insert(purchasesTable)
      .values({
        listingId: listing.id,
        buyerAccountId: buyer.id,
        priceUsd: listing.priceUsd,
        solAmount: cookAmountNum.toFixed(9),
        expectedLamports: lamports.toString(),
        currency: COOKIE_PAYMENT_CURRENCY,
        paymentChain: "cookie-chain",
        quoteExpiresAt: new Date(Date.now() + COOKIE_QUOTE_TTL_MS),
        destination: COOKIE_PAYMENT_WALLET,
        paymentReference: randomUUID(),
        payerWallet,
      })
      .returning();

    req.log.info({ id: row.id, listingId: listing.id, currency: COOKIE_PAYMENT_CURRENCY, lamports: lamports.toString() }, "purchase created");
    res.status(201).json(serializePurchase(row, listing));
  },
);

// ---------------------------------------------------------------------------
// Buyer's own purchases (authed)
// ---------------------------------------------------------------------------
router.get("/marketplace/my-purchases", requireAuth, async (req, res): Promise<void> => {
  const buyer = currentAccount(res);
  res.setHeader("Cache-Control", "private, no-store");
  // Left join the buyer's own review (if any) for the same listing so the My
  // Purchases UI can show "already reviewed" / pre-fill the rating form.
  const rows = await db
    .select({ purchase: purchasesTable, listing: listingsTable, review: reviewsTable })
    .from(purchasesTable)
    .innerJoin(listingsTable, eq(purchasesTable.listingId, listingsTable.id))
    .leftJoin(
      reviewsTable,
      and(
        eq(reviewsTable.listingId, purchasesTable.listingId),
        eq(reviewsTable.buyerAccountId, buyer.id),
      ),
    )
    .where(eq(purchasesTable.buyerAccountId, buyer.id))
    .orderBy(desc(purchasesTable.createdAt));
  res.json(rows.map((r) => serializePurchase(r.purchase, r.listing, r.review)));
});

// ---------------------------------------------------------------------------
// Confirm a purchase by submitting the on-chain payment signature (authed)
// ---------------------------------------------------------------------------
router.post(
  "/marketplace/purchases/:id/confirm",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = ConfirmPurchaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A valid transaction signature is required" });
      return;
    }
    const { signature } = parsed.data;
    const buyer = currentAccount(res);

    const [purchase] = await db
      .select()
      .from(purchasesTable)
      .where(eq(purchasesTable.id, id))
      .limit(1);
    // Bind to the authenticated buyer; 404 (not 403) so purchase ids can't be
    // enumerated by another account.
    if (!purchase || purchase.buyerAccountId !== buyer.id) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, purchase.listingId))
      .limit(1);
    if (!listing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Defensive: a buyer must never settle their own listing.
    if (listing.sellerAccountId === buyer.id) {
      res.status(400).json({ error: "You can't buy your own listing" });
      return;
    }

    // Already settled — idempotent success. Still (re-)credit the seller; the
    // deterministic key makes this a no-op if it already happened, and heals a
    // prior crash between claim and credit.
    if (purchase.paymentStatus === "paid") {
      try {
        await creditSeller(listing, purchase.id, purchase.priceUsd);
      } catch (err) {
        req.log.error({ err, id }, "seller credit failed (already-paid path)");
      }
      res.json(serializePurchase(purchase, listing));
      return;
    }

    const verification = await verifyPurchasePayment(purchase, signature);

    if (!verification.ok) {
      // Safety net for a broadcast-but-not-yet-confirmed tx: record it on the
      // non-unique submitted column (never used for dup/replay/gating) so a
      // paid-but-unconfirmed order isn't lost. Only stamp orders still pending
      // without a verified signature.
      if (verification.reason === "Transaction not found or not yet confirmed") {
        await db
          .update(purchasesTable)
          .set({ submittedTxSignature: signature })
          .where(
            and(
              eq(purchasesTable.id, id),
              eq(purchasesTable.paymentStatus, "pending"),
              isNull(purchasesTable.paymentTxSignature),
            ),
          );
      } else {
        req.log.warn({ id, reason: verification.reason }, "purchase payment verification failed");
      }
      res.status(400).json({ error: verification.reason ?? "Payment verification failed" });
      return;
    }

    // Claim the signature system-wide (single-use across BOTH purchases and
    // rentals) and flip pending -> paid in one transaction, so a payment can't
    // settle two orders and concurrent confirms can't double-count.
    const outcome = await claimSignatureAndSettle(
      signature,
      { kind: "purchase", id },
      (tx) =>
        tx
          .update(purchasesTable)
          .set({
            paymentStatus: "paid",
            paymentTxSignature: signature,
            payerWallet:
              normalizeWalletForStorage(verification.payer) ??
              normalizeWalletForStorage(purchase.payerWallet),
          })
          .where(
            and(
              eq(purchasesTable.id, id),
              eq(purchasesTable.paymentStatus, "pending"),
            ),
          )
          .returning()
          .then((rows) => rows[0]),
    );

    if (outcome.status === "conflict") {
      res.status(400).json({ error: "This payment was already used" });
      return;
    }

    if (outcome.status === "already_settled") {
      // A concurrent request captured this payment; return current state and
      // ensure the seller is credited (idempotent).
      const [current] = await db
        .select()
        .from(purchasesTable)
        .where(eq(purchasesTable.id, id))
        .limit(1);
      try {
        await creditSeller(listing, id, current.priceUsd);
      } catch (err) {
        req.log.error({ err, id }, "seller credit failed (concurrent path)");
      }
      res.json(serializePurchase(current, listing));
      return;
    }

    // Won the claim: bump the cached sales counter exactly once.
    const claimedRow = outcome.row;
    await db
      .update(listingsTable)
      .set({ salesCount: sql`${listingsTable.salesCount} + 1` })
      .where(eq(listingsTable.id, listing.id));

    try {
      await creditSeller(listing, id, claimedRow.priceUsd);
    } catch (err) {
      req.log.error({ err, id }, "seller credit failed (claim path)");
    }

    req.log.info({ id, listingId: listing.id }, "purchase confirmed (paid)");
    res.json(serializePurchase(claimedRow, listing));
  },
);

// ---------------------------------------------------------------------------
// Short-lived download URL for a paid purchase (authed, owner only)
// ---------------------------------------------------------------------------
router.get(
  "/marketplace/purchases/:id/download",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const buyer = currentAccount(res);
    const [purchase] = await db
      .select()
      .from(purchasesTable)
      .where(eq(purchasesTable.id, id))
      .limit(1);
    if (!purchase || purchase.buyerAccountId !== buyer.id) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (purchase.paymentStatus !== "paid") {
      res.status(403).json({ error: "This purchase has not been paid for yet" });
      return;
    }
    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, purchase.listingId))
      .limit(1);
    if (!listing || !listing.objectPath) {
      res.status(404).json({ error: "File not available" });
      return;
    }

    const svc = new ObjectStorageService();
    let downloadURL: string;
    try {
      downloadURL = await svc.getObjectEntityDownloadURL(listing.objectPath, DOWNLOAD_TTL_SECONDS);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File not available" });
        return;
      }
      req.log.error({ err, id }, "download url signing failed");
      res.status(503).json({ error: "Unable to generate a download link right now" });
      return;
    }
    res.json({ downloadURL, expiresInSeconds: DOWNLOAD_TTL_SECONDS });
  },
);

// ---------------------------------------------------------------------------
// List a listing's reviews (public, PII-safe)
// ---------------------------------------------------------------------------
router.get("/marketplace/listings/:id/reviews", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({
      review: reviewsTable,
      walletAddress: rewardAccountsTable.walletAddress,
      handle: rewardAccountsTable.handle,
    })
    .from(reviewsTable)
    .innerJoin(rewardAccountsTable, eq(reviewsTable.buyerAccountId, rewardAccountsTable.id))
    .where(eq(reviewsTable.listingId, id))
    .orderBy(desc(reviewsTable.createdAt))
    .limit(100);
  res.json(
    rows.map((r) =>
      serializeReview(r.review, { walletAddress: r.walletAddress, handle: r.handle }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Leave a rating + review for a purchased listing (authed, purchase-gated)
// ---------------------------------------------------------------------------
// Only an account with a confirmed paid purchase of this listing may review it,
// and only once — the unique (buyer_account_id, listing_id) constraint enforces
// the one-per-buyer rule even under a race (caught via the cause chain).
router.post(
  "/marketplace/listings/:id/reviews",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = CreateReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid review" });
      return;
    }
    const rating = parsed.data.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "Rating must be a whole number from 1 to 5" });
      return;
    }
    const body = (parsed.data.body ?? "").trim().slice(0, REVIEW_BODY_MAX);
    const buyer = currentAccount(res);

    // The listing must exist (any status — a buyer can still review an asset
    // that was later removed). 404 (not 403) keeps ids non-enumerable.
    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, id))
      .limit(1);
    if (!listing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Purchase gate: require at least one confirmed paid purchase of this
    // listing by the authenticated buyer.
    const [paid] = await db
      .select({ id: purchasesTable.id })
      .from(purchasesTable)
      .where(
        and(
          eq(purchasesTable.listingId, id),
          eq(purchasesTable.buyerAccountId, buyer.id),
          eq(purchasesTable.paymentStatus, "paid"),
        ),
      )
      .limit(1);
    if (!paid) {
      res.status(403).json({ error: "Only buyers of this asset can review it" });
      return;
    }

    try {
      const [row] = await db
        .insert(reviewsTable)
        .values({ listingId: id, buyerAccountId: buyer.id, rating, body })
        .returning();
      req.log.info({ id: row.id, listingId: id, rating }, "review created");
      res.status(201).json(
        serializeReview(row, { walletAddress: buyer.walletAddress, handle: buyer.handle }),
      );
    } catch (err) {
      // One review per buyer per listing — the unique constraint surfaces a
      // repeat as a clean 409 instead of a silent 500 (SQLSTATE is on the cause
      // chain under Drizzle).
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "You've already reviewed this asset" });
        return;
      }
      throw err;
    }
  },
);

export default router;
