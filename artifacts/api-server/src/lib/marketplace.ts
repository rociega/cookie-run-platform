// Creator marketplace helpers: serializers (owner / public / purchase) and the
// off-chain payout calculation.
//
// Sellers are paid in off-chain ICPX *points*, never in the on-chain currency
// the buyer paid with. The platform keeps MARKETPLACE_FEE_BPS of the gross; the
// seller nets priceUsd * POINTS_PER_USD * (10000 - FEE_BPS) / 10000 points (see
// config.ts). The uploaded file's object_path is NEVER exposed in any
// serializer — the file is only ever reachable through the gated download route.
import { eq } from "drizzle-orm";
import {
  db,
  rewardAccountsTable,
  type Listing,
  type Purchase,
  type Review,
} from "@workspace/db";
import { POINTS_PER_USD, MARKETPLACE_FEE_BPS, PAYMENT_WALLET } from "./config";
import { earn, targetKey } from "./rewards";

export const LISTING_CATEGORIES = ["model", "dataset", "template"] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export function isListingCategory(v: unknown): v is ListingCategory {
  return typeof v === "string" && (LISTING_CATEGORIES as readonly string[]).includes(v);
}

function round4(n: number): number {
  return Math.max(0, Math.round(n * 10_000) / 10_000);
}

// Points the seller nets from a sale, after the platform's cut. Rounded to 4
// decimals to match the earn()/balance precision.
export function sellerPayoutPoints(priceUsd: number): number {
  return round4(
    (priceUsd * POINTS_PER_USD * (10_000 - MARKETPLACE_FEE_BPS)) / 10_000,
  );
}

// Same masking convention as the rewards leaderboard.
function maskWallet(addr: string): string {
  return addr.length > 8 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

// Seller-facing (owner) view. Never includes object_path. `hasFile` lets the
// seller's UI know whether the upload step is complete without leaking the path.
export function serializeListing(l: Listing) {
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    category: l.category,
    priceUsd: l.priceUsd,
    status: l.status,
    salesCount: l.salesCount,
    hasFile: l.objectPath != null,
    fileName: l.fileName,
    fileSizeBytes: l.fileSizeBytes,
    suggestedTemplateId: l.suggestedTemplateId,
    createdAt: l.createdAt.toISOString(),
  };
}

// Aggregate rating summary for a listing, folded into the public serializer so
// Browse and the detail view can show a star average + review count. `avgRating`
// is null when there are no reviews yet.
export interface RatingAggregate {
  avgRating: number | null;
  reviewCount: number;
}

const EMPTY_RATING: RatingAggregate = { avgRating: null, reviewCount: 0 };

// Normalize a raw SQL aggregate row (avg comes back as a numeric string, count
// as a string/number depending on the driver) into a RatingAggregate.
export function toRatingAggregate(raw: {
  avg: string | number | null;
  count: string | number | null;
}): RatingAggregate {
  const count = Number(raw.count ?? 0);
  if (!count || raw.avg == null) return EMPTY_RATING;
  return { avgRating: Math.round(Number(raw.avg) * 100) / 100, reviewCount: count };
}

// Public/buyer view. Omits object_path and the seller's email; the seller wallet
// is masked. Seller handle (a user-chosen public display name) may be shown.
// The rating aggregate is optional so callers that don't join reviews still get
// a well-formed (zeroed) shape.
export function serializeListingPublic(
  l: Listing,
  seller: { walletAddress: string; handle: string | null },
  rating: RatingAggregate = EMPTY_RATING,
) {
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    category: l.category,
    priceUsd: l.priceUsd,
    salesCount: l.salesCount,
    sellerWallet: maskWallet(seller.walletAddress),
    sellerHandle: seller.handle,
    fileName: l.fileName,
    fileSizeBytes: l.fileSizeBytes,
    suggestedTemplateId: l.suggestedTemplateId,
    avgRating: rating.avgRating,
    reviewCount: rating.reviewCount,
    createdAt: l.createdAt.toISOString(),
  };
}

// Public review view. The reviewer's wallet is masked exactly like the seller
// wallet; a user-chosen handle may be shown. No account id is ever exposed.
export function serializeReview(
  r: Review,
  reviewer: { walletAddress: string; handle: string | null },
) {
  return {
    id: r.id,
    rating: r.rating,
    body: r.body,
    buyerWallet: maskWallet(reviewer.walletAddress),
    buyerHandle: reviewer.handle,
    createdAt: r.createdAt.toISOString(),
  };
}

// Buyer-facing purchase + payment quote. Mirrors the rentals payment shape so
// the existing wallet-checkout flow can drive it unchanged. Listing context
// (title/category/suggestedTemplateId) is folded in so the confirm response can
// directly drive the "download" + "launch in rental" UI.
export function serializePurchase(
  p: Purchase,
  listing: Listing,
  myReview: Review | null = null,
) {
  return {
    id: p.id,
    listingId: p.listingId,
    listingTitle: listing.title,
    category: listing.category,
    suggestedTemplateId: listing.suggestedTemplateId,
    priceUsd: p.priceUsd,
    solAmount: p.solAmount,
    lamports: p.expectedLamports,
    currency: p.currency,
    destination: p.destination ?? PAYMENT_WALLET,
    paymentChain: p.paymentChain,
    chainId: p.chainId,
    amountBaseUnits: p.amountBaseUnits,
    ethAmount: p.ethAmount,
    quoteExpiresAt: p.quoteExpiresAt?.toISOString() ?? null,
    priceBeforeDiscountUsd: p.priceBeforeDiscountUsd,
    discountUsd: p.discountUsd,
    tokenDiscountBps: p.tokenDiscountBps,
    tokenMint: p.tokenMint,
    tokenAmount: p.tokenAmount,
    expectedTokenAmount: p.expectedTokenAmount,
    tokenDestination: p.tokenDestination,
    paymentReference: p.paymentReference,
    payerWallet: p.payerWallet,
    paymentStatus: p.paymentStatus,
    paymentTxSignature: p.paymentTxSignature,
    // The buyer's own review of this listing (null if they haven't left one).
    // Lets the My Purchases UI show "already reviewed" / pre-fill the form.
    myReview: myReview
      ? { id: myReview.id, rating: myReview.rating, body: myReview.body }
      : null,
    createdAt: p.createdAt.toISOString(),
  };
}

// Credit the seller their off-chain ICPX payout for a paid purchase. The
// deterministic idempotency key (account + "marketplace_sale" + purchaseId)
// makes this safe to call on EVERY confirm of a paid purchase: a repeat hits the
// unique constraint and returns alreadyEarned, so a crash between claiming the
// payment and crediting the seller self-heals on the next confirm (or on a
// background reconciliation pass). Fail-soft is the CALLER's responsibility — a
// credit error never breaks the buyer's confirm because the payment is already
// captured and the next pass retries.
export async function creditSeller(
  listing: Listing,
  purchaseId: number,
  priceUsd: string,
): Promise<void> {
  const amount = sellerPayoutPoints(Number(priceUsd));
  if (amount <= 0) return;
  const [seller] = await db
    .select()
    .from(rewardAccountsTable)
    .where(eq(rewardAccountsTable.id, listing.sellerAccountId))
    .limit(1);
  if (!seller) return;
  await earn({
    account: seller,
    actionType: "marketplace_sale",
    amount,
    idempotencyKey: targetKey(seller.id, "marketplace_sale", purchaseId),
    metadata: { purchaseId, listingId: listing.id },
    emailable: true,
    emailNote: `Someone bought "${listing.title}" on the ICPX marketplace — your payout has landed.`,
  });
}
