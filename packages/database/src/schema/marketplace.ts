import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rewardAccountsTable as rewardAccountsRef } from "./rewards";

// Creator marketplace: users sell digital AI assets (models/LoRAs/checkpoints,
// datasets, templates/workflows). The platform takes a cut; the seller is paid
// in off-chain ICPX points (see lib/marketplace.ts payout calc), NOT in the
// on-chain currency the buyer paid with. The uploaded file lives in object
// storage (PRIVATE_OBJECT_DIR) and is only ever served through the gated
// download route — object_path is never exposed in any serializer.
//
// Money/amounts are stored as strings (same convention as the rentals table):
//   price_usd        — USD price, e.g. "12.4800"
//   sol_amount       — SOL to send, e.g. "0.083421"
//   expected_lamports — integer lamports as a string, compared with BigInt
export const listingsTable = pgTable("marketplace_listings", {
  id: serial("id").primaryKey(),
  sellerAccountId: integer("seller_account_id")
    .notNull()
    .references(() => rewardAccountsRef.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // model | dataset | template — validated at the route layer.
  category: text("category").notNull(),
  priceUsd: text("price_usd").notNull(),
  // Object-storage path of the uploaded file (e.g. "/objects/uploads/<uuid>").
  // Null until the upload is finalized; NEVER returned to clients.
  objectPath: text("object_path"),
  fileName: text("file_name"),
  // Byte size stored as a string to avoid 32-bit overflow on large model files.
  fileSizeBytes: text("file_size_bytes"),
  // draft | active | removed. Only active listings are browsable/purchasable.
  status: text("status").notNull().default("draft"),
  salesCount: integer("sales_count").notNull().default(0),
  // Optional bridge: for template/workflow listings, a catalog template id
  // (validated via findTemplate()) the buyer can launch a rental with. The
  // uploaded file is ALWAYS download-only — user content is never provisioned.
  suggestedTemplateId: text("suggested_template_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// One row per purchase attempt. Payment fields mirror the rentals table exactly
// so the same Solana verify + atomic-claim + replay-protection flow applies:
// payment_reference is the unique memo stamped on-chain; payment_tx_signature is
// unique and the dup/replay guard (checked against BOTH this and the rentals
// table at confirm). On a confirmed paid purchase the seller is credited points
// and the listing's sales_count is incremented.
export const purchasesTable = pgTable("marketplace_purchases", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id")
    .notNull()
    .references(() => listingsTable.id),
  buyerAccountId: integer("buyer_account_id")
    .notNull()
    .references(() => rewardAccountsRef.id),
  priceUsd: text("price_usd").notNull(),
  solAmount: text("sol_amount").notNull(),
  expectedLamports: text("expected_lamports").notNull(),
  currency: text("currency").notNull().default("SOL"),
  destination: text("destination"),
  // Generic chain-payment fields. Additive so historical SOL/ICPX purchases
  // retain their original columns and settlement behavior.
  paymentChain: text("payment_chain"),
  chainId: integer("chain_id"),
  amountBaseUnits: text("amount_base_units"),
  ethAmount: text("eth_amount"),
  tokenContract: text("token_contract"),
  assetDecimals: integer("asset_decimals"),
  quoteExpiresAt: timestamp("quote_expires_at", { withTimezone: true }),
  priceBeforeDiscountUsd: text("price_before_discount_usd"),
  discountUsd: text("discount_usd"),
  tokenDiscountBps: integer("token_discount_bps"),
  // $ICPX SPL-token payment fields (null for SOL purchases). Same semantics as
  // the rentals table: raw base units in expected_token_amount (string/BigInt),
  // human display in token_amount, operator ATA in token_destination.
  tokenMint: text("token_mint"),
  expectedTokenAmount: text("expected_token_amount"),
  tokenAmount: text("token_amount"),
  tokenDestination: text("token_destination"),
  paymentReference: text("payment_reference").notNull().unique(),
  payerWallet: text("payer_wallet"),
  paymentTxSignature: text("payment_tx_signature").unique(),
  // A signature the client broadcast but that has NOT verified yet. Recorded as
  // a safety net; deliberately non-unique and never used for dup/replay checks
  // or gating (only the verified payment_tx_signature is).
  submittedTxSignature: text("submitted_tx_signature"),
  // pending | paid | failed
  paymentStatus: text("payment_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertListingSchema = createInsertSchema(listingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listingsTable.$inferSelect;

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchasesTable.$inferSelect;

// One star rating + short written review per buyer per listing. Only accounts
// with a confirmed paid purchase of the listing may insert a row — enforced at
// the route layer. The unique (buyer_account_id, listing_id) constraint makes a
// second review by the same buyer hit a unique violation (handled like the
// rewards ledger: caught via the cause chain and surfaced as "already reviewed",
// see lib/marketplace.ts). Reviews are public; the reviewer's wallet is masked
// in the serializer exactly like the seller wallet elsewhere.
export const reviewsTable = pgTable(
  "marketplace_reviews",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listingsTable.id),
    buyerAccountId: integer("buyer_account_id")
      .notNull()
      .references(() => rewardAccountsRef.id),
    // Star rating, 1–5. Bounded at the route layer.
    rating: integer("rating").notNull(),
    // Optional short written review.
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("marketplace_reviews_buyer_listing_uq").on(t.buyerAccountId, t.listingId)],
);

export const insertReviewSchema = createInsertSchema(reviewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewsTable.$inferSelect;
