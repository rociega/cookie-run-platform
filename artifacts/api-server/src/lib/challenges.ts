// The ForgeRun launch event: 10 challenges, harder challenges pay more but
// have fewer claim slots (10 -> 1 as the ladder gets harder). Rewards are paid
// out MANUALLY by an operator after reviewing challenge_claims — this module
// only tracks eligibility and allocates slots, it never credits ICPX balance
// or moves any funds.
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  rentalsTable,
  referralsTable,
  challengeClaimsTable,
  type RewardAccount,
} from "@workspace/db";
import { walletColumnEquals } from "./walletAuth";

export interface ChallengeDef {
  key: string;
  order: number; // 1 (hardest, 1 slot) .. 10 (easiest, 10 slots)
  slots: number;
  title: string;
  description: string;
  rewardNote: string;
  // Returns null when eligible, or a user-facing reason when not.
  checkEligible: (account: RewardAccount) => Promise<string | null>;
}

async function paidRentalsForWallet(wallet: string) {
  return db
    .select({
      id: rentalsTable.id,
      createdAt: rentalsTable.createdAt,
      gpuModel: rentalsTable.gpuModel,
      priceUsd: rentalsTable.priceUsd,
      repositoryUrl: rentalsTable.repositoryUrl,
      containerImage: rentalsTable.containerImage,
    })
    .from(rentalsTable)
    .where(
      and(walletColumnEquals(rentalsTable.payerWallet, wallet), eq(rentalsTable.paymentStatus, "paid")),
    );
}

const HIGH_TIER_GPU_MATCH = /h100|h200|b200|a100/i;
const SPEND_THRESHOLD_USD = 100;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CHALLENGES: ChallengeDef[] = [
  {
    key: "connect_and_complete",
    order: 10,
    slots: 10,
    title: "Get set up",
    description: "Connect your wallet and pick a handle.",
    rewardNote: "Entry tier reward — details announced at event close.",
    checkEligible: async (a) =>
      a.handle ? null : "Pick a handle on your rewards profile first.",
  },
  {
    key: "first_rental",
    order: 9,
    slots: 9,
    title: "First rental",
    description: "Complete your first paid GPU rental of any size.",
    rewardNote: "Tier 9 reward — details announced at event close.",
    checkEligible: async (a) => {
      const rows = await paidRentalsForWallet(a.walletAddress);
      return rows.length > 0 ? null : "Complete a paid GPU rental first.";
    },
  },
  {
    key: "referred_paid_friend",
    order: 8,
    slots: 8,
    title: "Bring a friend",
    description: "Refer a friend who completes a paid rental.",
    rewardNote: "Tier 8 reward — details announced at event close.",
    checkEligible: async (a) => {
      const [row] = await db
        .select({ n: count() })
        .from(referralsTable)
        .where(and(eq(referralsTable.referrerAccountId, a.id), sql`${referralsTable.qualifiedAt} is not null`));
      return (row?.n ?? 0) > 0
        ? null
        : "Refer a friend who signs in and completes a paid rental.";
    },
  },
  {
    key: "three_in_a_week",
    order: 7,
    slots: 7,
    title: "On a roll",
    description: "Complete 3 paid rentals within a single 7-day window.",
    rewardNote: "Tier 7 reward — details announced at event close.",
    checkEligible: async (a) => {
      const rows = await paidRentalsForWallet(a.walletAddress);
      const times = rows.map((r) => r.createdAt.getTime()).sort((x, y) => x - y);
      for (let i = 0; i + 2 < times.length; i++) {
        if (times[i + 2] - times[i] <= WEEK_MS) return null;
      }
      return "Complete 3 paid rentals within any 7-day window.";
    },
  },
  {
    key: "high_tier_gpu",
    order: 6,
    slots: 6,
    title: "Go big",
    description: "Rent a top-tier GPU (H100/H200/B200/A100 class).",
    rewardNote: "Tier 6 reward — details announced at event close.",
    checkEligible: async (a) => {
      const rows = await paidRentalsForWallet(a.walletAddress);
      return rows.some((r) => HIGH_TIER_GPU_MATCH.test(r.gpuModel))
        ? null
        : "Rent an H100/H200/B200/A100-class GPU.";
    },
  },
  {
    key: "full_day_run",
    order: 5,
    slots: 5,
    title: "Marathon",
    description: "Keep a workspace active for a full 24-hour rental.",
    rewardNote: "Tier 5 reward — details announced at event close.",
    checkEligible: async (a) => {
      const rows = await db
        .select({ durationHours: rentalsTable.durationHours })
        .from(rentalsTable)
        .where(
          and(
            walletColumnEquals(rentalsTable.payerWallet, a.walletAddress),
            eq(rentalsTable.paymentStatus, "paid"),
          ),
        );
      return rows.some((r) => r.durationHours >= 24)
        ? null
        : "Complete a rental of 24 hours or longer.";
    },
  },
  {
    key: "private_source_used",
    order: 4,
    slots: 4,
    title: "Bring your own code",
    description: "Launch a workspace from your own repository or container image.",
    rewardNote: "Tier 4 reward — details announced at event close.",
    checkEligible: async (a) => {
      const rows = await paidRentalsForWallet(a.walletAddress);
      return rows.some((r) => r.repositoryUrl || r.containerImage)
        ? null
        : "Launch a rental with a repository or container image set.";
    },
  },
  {
    key: "spend_threshold",
    order: 3,
    slots: 3,
    title: "Power user",
    description: `Cross $${SPEND_THRESHOLD_USD} in total paid rentals.`,
    rewardNote: "Tier 3 reward — details announced at event close.",
    checkEligible: async (a) => {
      const rows = await paidRentalsForWallet(a.walletAddress);
      const total = rows.reduce((s, r) => s + Number(r.priceUsd || 0), 0);
      return total >= SPEND_THRESHOLD_USD
        ? null
        : `Reach $${SPEND_THRESHOLD_USD} in total paid rentals ($${total.toFixed(2)} so far).`;
    },
  },
  {
    key: "five_referrals",
    order: 2,
    slots: 2,
    title: "Community builder",
    description: "Refer 5 friends who each complete a paid rental.",
    rewardNote: "Tier 2 reward — details announced at event close.",
    checkEligible: async (a) => {
      const [row] = await db
        .select({ n: count() })
        .from(referralsTable)
        .where(and(eq(referralsTable.referrerAccountId, a.id), sql`${referralsTable.qualifiedAt} is not null`));
      return (row?.n ?? 0) >= 5
        ? null
        : `Refer 5 friends who complete a paid rental (${row?.n ?? 0}/5 so far).`;
    },
  },
  {
    key: "grand_finisher",
    order: 1,
    slots: 1,
    title: "Grand finisher",
    description: "First to complete all 9 prior challenges. Sole winner, biggest reward.",
    rewardNote: "Grand prize — the single largest reward of the event.",
    checkEligible: async (a) => {
      const priorKeys = CHALLENGES.filter((c) => c.order !== 1).map((c) => c.key);
      const rows = await db
        .select({ challengeKey: challengeClaimsTable.challengeKey })
        .from(challengeClaimsTable)
        .where(eq(challengeClaimsTable.accountId, a.id));
      const claimed = new Set(rows.map((r) => r.challengeKey));
      const missing = priorKeys.filter((k) => !claimed.has(k));
      return missing.length === 0
        ? null
        : `Complete all 9 other challenges first (${9 - missing.length}/9 so far).`;
    },
  },
];

export const CHALLENGE_MAP: Record<string, ChallengeDef> = Object.fromEntries(
  CHALLENGES.map((c) => [c.key, c]),
);

export interface ChallengeView {
  key: string;
  order: number;
  slots: number;
  slotsClaimed: number;
  slotsRemaining: number;
  title: string;
  description: string;
  rewardNote: string;
  myStatus: "claimed" | "full" | "eligible" | "ineligible" | null;
  myReason: string | null;
  myRank: number | null;
}

export async function slotsClaimed(challengeKey: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(challengeClaimsTable)
    .where(eq(challengeClaimsTable.challengeKey, challengeKey));
  return row?.n ?? 0;
}

export async function buildChallengeViews(account: RewardAccount | null): Promise<ChallengeView[]> {
  const claimed = account
    ? await db
        .select()
        .from(challengeClaimsTable)
        .where(eq(challengeClaimsTable.accountId, account.id))
    : [];
  const claimedByKey = new Map(claimed.map((c) => [c.challengeKey, c]));

  const views: ChallengeView[] = [];
  for (const def of [...CHALLENGES].sort((a, b) => b.order - a.order)) {
    const taken = await slotsClaimed(def.key);
    let myStatus: ChallengeView["myStatus"] = null;
    let myReason: string | null = null;
    let myRank: number | null = null;

    if (account) {
      const mine = claimedByKey.get(def.key);
      if (mine) {
        myStatus = "claimed";
        myRank = mine.rank;
      } else if (taken >= def.slots) {
        myStatus = "full";
      } else {
        const reason = await def.checkEligible(account);
        myStatus = reason ? "ineligible" : "eligible";
        myReason = reason;
      }
    }

    views.push({
      key: def.key,
      order: def.order,
      slots: def.slots,
      slotsClaimed: taken,
      slotsRemaining: Math.max(0, def.slots - taken),
      title: def.title,
      description: def.description,
      rewardNote: def.rewardNote,
      myStatus,
      myReason,
      myRank,
    });
  }
  return views;
}

export type ClaimOutcome =
  | { ok: true; rank: number }
  | { ok: false; reason: string };

// Atomic: locks the challenge's existing claim rows so two concurrent
// requests for the last slot can't both succeed, then re-checks eligibility
// and the slot cap inside the same transaction before inserting.
export async function claimChallenge(
  account: RewardAccount,
  challengeKey: string,
): Promise<ClaimOutcome> {
  const def = CHALLENGE_MAP[challengeKey];
  if (!def) return { ok: false, reason: "Unknown challenge" };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${challengeKey}))`);

    const [already] = await tx
      .select()
      .from(challengeClaimsTable)
      .where(
        and(
          eq(challengeClaimsTable.challengeKey, challengeKey),
          eq(challengeClaimsTable.accountId, account.id),
        ),
      )
      .limit(1);
    if (already) return { ok: false, reason: "You already claimed this challenge." };

    const [row] = await tx
      .select({ n: count() })
      .from(challengeClaimsTable)
      .where(eq(challengeClaimsTable.challengeKey, challengeKey));
    const taken = row?.n ?? 0;
    if (taken >= def.slots) return { ok: false, reason: "All slots for this challenge are claimed." };

    const reason = await def.checkEligible(account);
    if (reason) return { ok: false, reason };

    const rank = taken + 1;
    await tx.insert(challengeClaimsTable).values({
      challengeKey,
      accountId: account.id,
      rank,
      rewardNote: def.rewardNote,
    });
    return { ok: true, rank };
  });
}
