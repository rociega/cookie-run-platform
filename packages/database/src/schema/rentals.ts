import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Money/amounts are stored as strings to avoid floating-point drift:
//   priceUsd        — USD cost, e.g. "12.4800"
//   solAmount       — SOL to send, e.g. "0.083421"
//   expectedLamports — integer lamports as a string, compared with BigInt
export const rentalsTable = pgTable("rentals", {
  id: serial("id").primaryKey(),
  gpuModel: text("gpu_model").notNull(),
  durationHours: integer("duration_hours").notNull(),
  priceUsd: text("price_usd").notNull(),
  solAmount: text("sol_amount").notNull(),
  expectedLamports: text("expected_lamports").notNull(),
  currency: text("currency").notNull().default("SOL"),
  // Generic chain-payment fields. These are additive: SOL/ICPX history continues
  // to use the fields above, while new Robinhood Chain quotes use ETH base units.
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
  // Compute workload preset chosen for the workspace (null = bare GPU). Selects the
  // Docker image + onstart script + bundled disk + price markup. The id is
  // validated against the server-side catalog; the image/onstart are NEVER taken
  // from the client — they are resolved from the catalog at provision time.
  templateId: text("template_id"),
  // Optional public GitHub source reference. Credentials are intentionally not
  // part of this record; private repository access is not persisted.
  repositoryUrl: text("repository_url"),
  repositoryRevision: text("repository_revision"),
  // Optional public OCI image override. Registry credentials are workspace
  // runtime material and are never stored in the application database.
  containerImage: text("container_image"),
  // on-demand | spot | reserved — drives the price multiplier and whether the
  // Vast instance is provisioned interruptible (spot) or dedicated.
  instanceType: text("instance_type").notNull().default("on-demand"),
  // Extra persistent disk (GB) added on top of the template's bundled default.
  extraDiskGb: integer("extra_disk_gb").notNull().default(0),
  destination: text("destination").notNull(),
  // $ICPX SPL-token payment fields (null for SOL workspaces). tokenMint is the mint
  // quoted against; expectedTokenAmount is raw base units (string, compared with
  // BigInt); tokenAmount is the human display amount; tokenDestination is the
  // operator's associated token account (ATA) the buyer must transfer into.
  tokenMint: text("token_mint"),
  expectedTokenAmount: text("expected_token_amount"),
  tokenAmount: text("token_amount"),
  tokenDestination: text("token_destination"),
  paymentReference: text("payment_reference").notNull().unique(),
  payerWallet: text("payer_wallet"),
  paymentTxSignature: text("payment_tx_signature").unique(),
  // A signature the client broadcast but that has NOT verified yet (slow or
  // dropped confirmation, or the tab closed before /confirm finalized). Recorded
  // as a safety net so a paid-but-unconfirmed order is never silently lost.
  // Deliberately non-unique and never used for dup/replay checks or PII gating
  // (only the verified payment_tx_signature is), so a public on-chain signature
  // can't be POSTed here to squat someone else's order.
  submittedTxSignature: text("submitted_tx_signature"),
  // pending | paid | failed
  paymentStatus: text("payment_status").notNull().default("pending"),
  vastOfferId: text("vast_offer_id"),
  vastInstanceId: text("vast_instance_id"),
  // pending_payment | provisioning | active | failed
  status: text("status").notNull().default("pending_payment"),
  email: text("email"),
  sshKey: text("ssh_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertRentalSchema = createInsertSchema(rentalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRental = z.infer<typeof insertRentalSchema>;
export type Rental = typeof rentalsTable.$inferSelect;

// The persisted table keeps its historical name so existing rows and
// deployments remain readable during the product rename. New service code
// should use the workspace aliases at the domain boundary.
export const workspacesTable = rentalsTable;
export const insertWorkspaceSchema = insertRentalSchema;
export type InsertWorkspace = InsertRental;
export type Workspace = Rental;
