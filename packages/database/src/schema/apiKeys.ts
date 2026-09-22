import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { rewardAccountsTable } from "./rewards";

// Developer API keys for programmatic access. The plaintext key is shown ONCE on
// creation and never stored — only its SHA-256 hash. Keys are high-entropy
// random secrets, so a fast indexed hash lookup is the correct scheme (bcrypt is
// for low-entropy passwords and would force a slow scan). displayPrefix + last4
// let the UI show a recognizable, non-secret label for each key.
export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => rewardAccountsTable.id),
    label: text("label").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    displayPrefix: text("display_prefix").notNull(),
    last4: text("last4").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_account_idx").on(t.accountId)],
);

export type ApiKey = typeof apiKeysTable.$inferSelect;
