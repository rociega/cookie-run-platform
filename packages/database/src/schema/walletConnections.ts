import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walletConnectionsTable = pgTable("wallet_connections", {
  id: serial("id").primaryKey(),
  address: text("address").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWalletConnectionSchema = createInsertSchema(walletConnectionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWalletConnection = z.infer<typeof insertWalletConnectionSchema>;
export type WalletConnection = typeof walletConnectionsTable.$inferSelect;
