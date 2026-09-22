import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

// System-wide single-use gate for on-chain payment signatures.
//
// A verified payment signature may settle AT MOST ONE order across the entire
// system. The rentals and marketplace_purchases tables each have their OWN unique
// payment_tx_signature column, but those constraints are independent — nothing at
// the DB level stops the same signature being written once into rentals AND once
// into purchases. Without a single shared constraint, a payer whose transaction
// carries both order references could settle a purchase and then replay the
// identical signature onto a rental (or vice-versa).
//
// This table is that single constraint. Every settlement path (both confirm
// routes and both reconciler loops) claims the signature here with an atomic
// `INSERT ... ON CONFLICT DO NOTHING` BEFORE flipping its order to paid. The
// primary key on `signature` makes the insert the one serialization point that
// closes the cross-table replay race under concurrency — only one caller can win
// the insert; everyone else learns whether they already own it (idempotent retry)
// or another order does (replay → reject). See claimSignatureAndSettle().
export const consumedPaymentSignaturesTable = pgTable(
  "consumed_payment_signatures",
  {
    // The on-chain transaction signature — globally unique, so the PK is the gate.
    signature: text("signature").primaryKey(),
    // Which order consumed it ("rental" | "purchase"), so an idempotent retry by
    // the SAME order is not mistaken for a cross-order replay.
    orderKind: text("order_kind").notNull(),
    orderId: integer("order_id").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type ConsumedPaymentSignature =
  typeof consumedPaymentSignaturesTable.$inferSelect;
