import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const sourceRateLimitsTable = pgTable("source_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});