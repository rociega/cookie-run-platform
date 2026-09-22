import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whitelistTable = pgTable("whitelist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  walletAddress: text("wallet_address"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhitelistSchema = createInsertSchema(whitelistTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWhitelist = z.infer<typeof insertWhitelistSchema>;
export type Whitelist = typeof whitelistTable.$inferSelect;
