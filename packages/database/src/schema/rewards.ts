import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  date,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Off-chain ICPX rewards. Balances are points (NOT a real token), stored as
// numeric and returned by Drizzle as strings to avoid float drift — same
// money-as-string convention used by the rentals table.

export const rewardAccountsTable = pgTable("reward_accounts", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  email: text("email"),
  handle: text("handle"),
  balance: numeric("balance", { precision: 20, scale: 4 }).notNull().default("0"),
  referralCode: text("referral_code").notNull().unique(),
  referredByCode: text("referred_by_code"),
  checkinStreak: integer("checkin_streak").notNull().default(0),
  lastCheckinDate: date("last_checkin_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Append-only ledger. idempotency_key enforces earn cadence:
//   once      -> "<accountId>:<action>"
//   daily     -> "<accountId>:<action>:<YYYY-MM-DD UTC>"
//   perTarget -> "<accountId>:<action>:<targetId>"
//   cooldown  -> "<accountId>:<action>:<epochBucket>"
export const earnEventsTable = pgTable("earn_events", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => rewardAccountsTable.id),
  actionType: text("action_type").notNull(),
  amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerAccountId: integer("referrer_account_id")
    .notNull()
    .references(() => rewardAccountsTable.id),
  refereeAccountId: integer("referee_account_id")
    .notNull()
    .unique()
    .references(() => rewardAccountsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
});

// Off-chain staking of earned ICPX points. Staking moves `amount` OUT of the
// account balance (recorded as a negative stake_lock earn_event so the
// balance = sum(earn_events.amount) invariant holds). Unstaking after the lock
// returns principal + a flat lock bonus (bonus_bps); early unstaking returns
// principal only. The locked total is derived from active rows here.
export const stakesTable = pgTable("stakes", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => rewardAccountsTable.id),
  amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
  bonusBps: integer("bonus_bps").notNull(),
  lockDays: integer("lock_days").notNull(),
  status: text("status").notNull().default("active"), // active | unstaked
  stakedAt: timestamp("staked_at", { withTimezone: true }).notNull().defaultNow(),
  unlockAt: timestamp("unlock_at", { withTimezone: true }).notNull(),
  unstakedAt: timestamp("unstaked_at", { withTimezone: true }),
  rewardPaid: numeric("reward_paid", { precision: 20, scale: 4 }),
});

// Event-style challenge claims. Slot caps live in code (see api-server
// lib/challenges.ts, one entry per challengeKey), not in this table — this
// table only records who claimed a slot and in what order. Rewards for
// challenges are paid out manually (off-platform), so there is no automatic
// credit into reward_accounts.balance here; `rewardNote` is a human-readable
// description of what was promised, filled in from the challenge definition
// at claim time so it survives even if the definition later changes.
export const challengeClaimsTable = pgTable(
  "challenge_claims",
  {
    id: serial("id").primaryKey(),
    challengeKey: text("challenge_key").notNull(),
    accountId: integer("account_id")
      .notNull()
      .references(() => rewardAccountsTable.id),
    // 1-based position among claims for this challengeKey, assigned atomically
    // under a row lock so it can never exceed the challenge's slot cap.
    rank: integer("rank").notNull(),
    rewardNote: text("reward_note").notNull(),
    // pending | paid — set to "paid" manually by an operator once the reward is
    // actually sent; this table never triggers a payout itself.
    payoutStatus: text("payout_status").notNull().default("pending"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One claim per account per challenge, and one account per slot rank —
    // together these make slot allocation race-safe under a transaction.
    unique("challenge_claims_challenge_account_uq").on(t.challengeKey, t.accountId),
    unique("challenge_claims_challenge_rank_uq").on(t.challengeKey, t.rank),
  ],
);

// Hackathon-style technical missions. Definitions (title, description,
// reward tier) live in code — see api-server lib/missions.ts, one entry per
// missionKey — same split as challenges above. Unlike challenges, missions
// have no server-checkable eligibility: a user submits proof (a link, a
// write-up, or both) and an operator manually approves or rejects it.
// Approval never auto-credits reward_accounts.balance; `rewardNote` records
// what was promised at submission time so it survives definition edits.
export const missionSubmissionsTable = pgTable(
  "mission_submissions",
  {
    id: serial("id").primaryKey(),
    missionKey: text("mission_key").notNull(),
    accountId: integer("account_id")
      .notNull()
      .references(() => rewardAccountsTable.id),
    proofUrl: text("proof_url"),
    writeup: text("writeup"),
    rewardNote: text("reward_note").notNull(),
    // pending | approved | rejected — set by an operator on review. A
    // rejected submission can be resubmitted (same row, updated fields);
    // an approved one is final.
    status: text("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    // paid — set to "paid" manually by an operator once the reward is
    // actually sent; this table never triggers a payout itself.
    payoutStatus: text("payout_status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    // One active submission row per account per mission; resubmission after
    // rejection updates this row rather than inserting a new one.
    unique("mission_submissions_mission_account_uq").on(t.missionKey, t.accountId),
  ],
);

export const insertRewardAccountSchema = createInsertSchema(rewardAccountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRewardAccount = z.infer<typeof insertRewardAccountSchema>;
export type RewardAccount = typeof rewardAccountsTable.$inferSelect;
export type EarnEvent = typeof earnEventsTable.$inferSelect;
export type Referral = typeof referralsTable.$inferSelect;
export type Stake = typeof stakesTable.$inferSelect;
export type ChallengeClaim = typeof challengeClaimsTable.$inferSelect;
export type MissionSubmission = typeof missionSubmissionsTable.$inferSelect;
