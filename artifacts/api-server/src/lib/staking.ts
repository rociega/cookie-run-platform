// Off-chain ICPX staking.
//
// Staking moves points OUT of reward_accounts.balance into a `stakes` row for a
// fixed lock. To preserve the engine invariant balance = SUM(earn_events.amount),
// every balance change is mirrored by a ledger row:
//   - stake()   inserts a NEGATIVE stake_lock event and debits balance;
//   - unstake() inserts a POSITIVE stake_unlock event (principal) and, if the
//     lock matured, a POSITIVE stake_reward event (flat lock bonus), and credits
//     balance by principal + bonus. Early unstaking returns principal only.
//
// earn() is deliberately NOT reused: it clamps amounts to >= 0 (a safety
// property of the credit path), so it cannot post the negative lock entry.
import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  rewardAccountsTable,
  earnEventsTable,
  stakesTable,
  type RewardAccount,
  type Stake,
} from "@workspace/db";
import { isUniqueViolation } from "./rewards";
import { sendEmail, earnEmail } from "./email";
import { logger } from "./logger";

export interface StakeTier {
  lockDays: number;
  bonusBps: number;
  label: string;
}

// Flat lock BONUS (not APR) — APR on a points balance produces invisible dust.
export const STAKE_TIERS: StakeTier[] = [
  { lockDays: 7, bonusBps: 200, label: "7-day lock · +2%" },
  { lockDays: 30, bonusBps: 1000, label: "30-day lock · +10%" },
  { lockDays: 90, bonusBps: 4000, label: "90-day lock · +40%" },
];
export const MIN_STAKE = 100;

const TIER_MAP = new Map(STAKE_TIERS.map((t) => [t.lockDays, t]));

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface StakeView {
  id: number;
  amount: string;
  bonusBps: number;
  lockDays: number;
  status: string;
  stakedAt: string;
  unlockAt: string;
  unstakedAt: string | null;
  rewardPaid: string | null;
  matured: boolean;
  pendingReward: string;
}

function serializeStake(s: Stake): StakeView {
  const matured = Date.now() >= s.unlockAt.getTime();
  const principal = Number(s.amount);
  const pending =
    s.status === "active" && matured ? round4((principal * s.bonusBps) / 10_000) : 0;
  return {
    id: s.id,
    amount: s.amount,
    bonusBps: s.bonusBps,
    lockDays: s.lockDays,
    status: s.status,
    stakedAt: s.stakedAt.toISOString(),
    unlockAt: s.unlockAt.toISOString(),
    unstakedAt: s.unstakedAt ? s.unstakedAt.toISOString() : null,
    rewardPaid: s.rewardPaid,
    matured,
    pendingReward: pending.toFixed(4),
  };
}

export interface StakeMutation {
  ok: boolean;
  message: string;
  balance: string;
  stake?: StakeView;
  principal?: string | null;
  reward?: string | null;
}

export interface StakesPayload {
  stakes: StakeView[];
  tiers: StakeTier[];
  lockedTotal: string;
  availableBalance: string;
  minStake: number;
}

export async function listStakes(account: RewardAccount): Promise<StakesPayload> {
  const rows = await db
    .select()
    .from(stakesTable)
    .where(eq(stakesTable.accountId, account.id))
    .orderBy(desc(stakesTable.stakedAt));
  const lockedTotal = rows
    .filter((r) => r.status === "active")
    .reduce((sum, r) => sum + Number(r.amount), 0);
  return {
    stakes: rows.map(serializeStake),
    tiers: STAKE_TIERS,
    lockedTotal: round4(lockedTotal).toFixed(4),
    availableBalance: account.balance,
    minStake: MIN_STAKE,
  };
}

export async function stake(
  account: RewardAccount,
  amountInput: number,
  lockDays: number,
): Promise<StakeMutation> {
  const tier = TIER_MAP.get(lockDays);
  if (!tier) {
    return { ok: false, message: "Unknown lock tier", balance: account.balance };
  }
  const amount = round4(amountInput);
  if (!Number.isFinite(amount) || amount < MIN_STAKE) {
    return {
      ok: false,
      message: `Minimum stake is ${MIN_STAKE} ICPX`,
      balance: account.balance,
    };
  }
  const amtStr = amount.toFixed(4);
  const now = new Date();
  const unlockAt = new Date(now.getTime() + lockDays * 86_400_000);

  const result = await db.transaction(async (tx) => {
    // Conditional debit: only succeeds when balance >= amount (row lock + guard),
    // so concurrent stakes can never overdraw.
    const [debited] = await tx
      .update(rewardAccountsTable)
      .set({ balance: sql`${rewardAccountsTable.balance} - ${amtStr}` })
      .where(
        and(
          eq(rewardAccountsTable.id, account.id),
          sql`${rewardAccountsTable.balance} >= ${amtStr}`,
        ),
      )
      .returning({ balance: rewardAccountsTable.balance });
    if (!debited) return null;

    await tx.insert(earnEventsTable).values({
      accountId: account.id,
      actionType: "stake_lock",
      amount: (-amount).toFixed(4),
      idempotencyKey: `stake_lock:${crypto.randomUUID()}`,
      metadata: { lockDays, bonusBps: tier.bonusBps },
    });

    const [row] = await tx
      .insert(stakesTable)
      .values({
        accountId: account.id,
        amount: amtStr,
        bonusBps: tier.bonusBps,
        lockDays,
        unlockAt,
      })
      .returning();

    return { balance: debited.balance, row };
  });

  if (!result) {
    return {
      ok: false,
      message: "Not enough available ICPX to stake",
      balance: account.balance,
    };
  }
  return {
    ok: true,
    message: `Staked ${amount} ICPX for ${lockDays} days`,
    balance: result.balance,
    stake: serializeStake(result.row),
  };
}

export async function unstake(
  account: RewardAccount,
  stakeId: number,
): Promise<StakeMutation> {
  const now = new Date();
  try {
    const txResult = await db.transaction(async (tx) => {
      // Status-guarded flip is the concurrency gate: a second concurrent unstake
      // matches no row and returns null.
      const [flipped] = await tx
        .update(stakesTable)
        .set({ status: "unstaked", unstakedAt: now })
        .where(
          and(
            eq(stakesTable.id, stakeId),
            eq(stakesTable.accountId, account.id),
            eq(stakesTable.status, "active"),
          ),
        )
        .returning();
      if (!flipped) return null;

      const principal = round4(Number(flipped.amount));
      const matured = now.getTime() >= flipped.unlockAt.getTime();
      const reward = matured ? round4((principal * flipped.bonusBps) / 10_000) : 0;
      const credit = round4(principal + reward);

      await tx
        .update(stakesTable)
        .set({ rewardPaid: reward.toFixed(4) })
        .where(eq(stakesTable.id, stakeId));

      await tx.insert(earnEventsTable).values({
        accountId: account.id,
        actionType: "stake_unlock",
        amount: principal.toFixed(4),
        idempotencyKey: `stake_unlock:${stakeId}`,
        metadata: { stakeId },
      });
      if (reward > 0) {
        await tx.insert(earnEventsTable).values({
          accountId: account.id,
          actionType: "stake_reward",
          amount: reward.toFixed(4),
          idempotencyKey: `stake_reward:${stakeId}`,
          metadata: { stakeId, bonusBps: flipped.bonusBps },
        });
      }

      const [updated] = await tx
        .update(rewardAccountsTable)
        .set({ balance: sql`${rewardAccountsTable.balance} + ${credit.toFixed(4)}` })
        .where(eq(rewardAccountsTable.id, account.id))
        .returning({ balance: rewardAccountsTable.balance });

      const srow: Stake = { ...flipped, rewardPaid: reward.toFixed(4) };
      return { balance: updated.balance, principal, reward, matured, srow };
    });

    if (!txResult) {
      return {
        ok: false,
        message: "Stake not found or already unstaked",
        balance: account.balance,
      };
    }

    const { balance, principal, reward, matured, srow } = txResult;
    if (reward > 0 && account.email) {
      void sendStakeEmail(account.email, reward, balance);
    }
    const message = matured
      ? `Unstaked ${principal} ICPX + ${reward} bonus`
      : `Unstaked ${principal} ICPX early — no bonus`;
    return {
      ok: true,
      message,
      balance,
      principal: principal.toFixed(4),
      reward: reward.toFixed(4),
      stake: serializeStake(srow),
    };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        ok: false,
        message: "Stake already unstaked",
        balance: account.balance,
      };
    }
    throw e;
  }
}

async function sendStakeEmail(to: string, reward: number, balance: string): Promise<void> {
  try {
    await sendEmail({
      to,
      subject: `+${reward} ForgeRun points staking bonus`,
      html: earnEmail({
        label: "Staking bonus",
        amount: reward,
        balance,
        note: "Your stake matured — principal returned plus the lock bonus.",
      }),
    });
  } catch (err) {
    logger.warn({ err }, "stake email failed (non-fatal)");
  }
}
