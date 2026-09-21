// Off-chain ForgeRun points engine + action registry + game definitions.
//
// Earned points are not a real token: no on-chain transfer ever
// happens. The cached `balance` on reward_accounts is kept in lockstep with an
// append-only earn_events ledger inside a single transaction. Cadence is
// enforced by the unique idempotency_key (see schema). Game answers and spin
// randomness live ONLY here on the server and are never sent to the client.
import crypto from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  rewardAccountsTable,
  earnEventsTable,
  type RewardAccount,
  type EarnEvent,
} from "@workspace/db";
import { walletColumnEquals } from "./walletAuth";
import { sendEmail, earnEmail } from "./email";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
export const CHECKIN_BASE = 50;
export const CHECKIN_STREAK_BONUS = 10;
export const CHECKIN_MAX_BONUS = 100;

export const QUIZ_REWARD = 250;
export const QUIZ_PASS = 3;

export const TRIVIA_REWARD = 60;

export const MINE_AMOUNT = 5;
export const MINE_COOLDOWN_SECONDS = 60;
export const MINE_DAILY_CAP = 50;

export const REFERRAL_REWARD = 300;
export const FIRST_RENTAL_REWARD = 500;

export const DAILY_EMAIL_CAP = 10;

// ---------------------------------------------------------------------------
// Action registry (display + cadence + email policy)
// ---------------------------------------------------------------------------
export type Cadence = "once" | "daily" | "cooldown" | "perTarget";
export type Category = "onboarding" | "daily" | "games" | "social" | "product";

export interface ActionDef {
  type: string;
  label: string;
  description: string;
  category: Category;
  amount: number;
  cadence: Cadence;
  emailable: boolean;
}

export const ACTIONS: ActionDef[] = [
  // Onboarding
  { type: "connect_wallet", label: "Connect & sign in", description: "Verify wallet ownership to open your rewards account.", category: "onboarding", amount: 100, cadence: "once", emailable: true },
  { type: "add_email", label: "Add your email", description: "Get notified every time you earn ForgeRun points.", category: "onboarding", amount: 150, cadence: "once", emailable: true },
  { type: "complete_profile", label: "Pick a handle", description: "Choose a public display name for the leaderboard.", category: "onboarding", amount: 100, cadence: "once", emailable: true },
  // Daily
  { type: "daily_checkin", label: "Daily check-in", description: "Come back every day — streaks pay more.", category: "daily", amount: CHECKIN_BASE, cadence: "daily", emailable: true },
  { type: "spin_wheel", label: "Spin the wheel", description: "One free spin a day for 10–500 ForgeRun points.", category: "daily", amount: 500, cadence: "daily", emailable: true },
  { type: "daily_trivia", label: "Daily trivia", description: "One GPU/Solana question, fresh each day.", category: "daily", amount: TRIVIA_REWARD, cadence: "daily", emailable: true },
  { type: "guess_gpu_price", label: "Guess the GPU price", description: "Guess today's GPU hourly rate — closer pays more.", category: "daily", amount: 200, cadence: "daily", emailable: true },
  { type: "click_to_mine", label: "Click to mine", description: "Tap the rig to earn a few ForgeRun points on a short cooldown.", category: "daily", amount: MINE_AMOUNT, cadence: "cooldown", emailable: false },
  // Games
  { type: "gpu_quiz", label: "GPU knowledge quiz", description: "Pass the 5-question quiz to earn a big bonus.", category: "games", amount: QUIZ_REWARD, cadence: "once", emailable: true },
  // Social
  { type: "x_follow", label: "Follow ForgeRun on X", description: "Follow @ForgeRunxyz for launch updates.", category: "social", amount: 100, cadence: "once", emailable: true },
  { type: "x_share", label: "Share ForgeRun on X", description: "Post about ForgeRun — once a day.", category: "social", amount: 75, cadence: "daily", emailable: true },
  // Product
  { type: "first_rental", label: "Rent your first GPU", description: "Complete a real GPU rental payment.", category: "product", amount: FIRST_RENTAL_REWARD, cadence: "once", emailable: true },
  { type: "referral_qualified", label: "Refer a friend", description: "Earn when someone you referred signs in.", category: "product", amount: REFERRAL_REWARD, cadence: "perTarget", emailable: true },
];

export const ACTION_MAP: Record<string, ActionDef> = Object.fromEntries(
  ACTIONS.map((a) => [a.type, a]),
);

const EMAILABLE_TYPES = ACTIONS.filter((a) => a.emailable).map((a) => a.type);

// Social platform -> action type. Drives claimSocial.
export const SOCIAL_PLATFORMS: Record<string, string> = {
  x_follow: "x_follow",
  x_share: "x_share",
};

// ---------------------------------------------------------------------------
// Time helpers (server UTC)
// ---------------------------------------------------------------------------
export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function nextUtcDay(d = new Date()): Date {
  return new Date(startOfUtcDay(d).getTime() + 86_400_000);
}
export function utcDateKey(d = new Date()): string {
  return startOfUtcDay(d).toISOString().slice(0, 10);
}
function dayIndex(d = new Date()): number {
  return Math.floor(startOfUtcDay(d).getTime() / 86_400_000);
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------
export function onceKey(accountId: number, action: string): string {
  return `${accountId}:${action}`;
}
export function dailyKey(accountId: number, action: string, d = new Date()): string {
  return `${accountId}:${action}:${utcDateKey(d)}`;
}
export function targetKey(accountId: number, action: string, target: string | number): string {
  return `${accountId}:${action}:${target}`;
}
export function cooldownKey(
  accountId: number,
  action: string,
  windowSeconds: number,
): string {
  // Bucket by the cooldown window so the unique idempotency constraint
  // atomically blocks concurrent claims within the same window (the timestamp
  // gate governs the user-facing cooldown; this prevents double-credit races).
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  return `${accountId}:${action}:${bucket}`;
}

export function generateReferralCode(): string {
  return crypto.randomBytes(5).toString("hex");
}

// ---------------------------------------------------------------------------
// earn() — the single credit path
// ---------------------------------------------------------------------------
export interface EarnResult {
  credited: boolean;
  alreadyEarned: boolean;
  amount: number;
  balance: string;
  message: string;
}

export interface EarnArgs {
  account: RewardAccount;
  actionType: string;
  amount: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  emailable?: boolean;
  emailNote?: string;
}

export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur != null; depth++) {
    if (typeof cur === "object" && (cur as { code?: string }).code === "23505") {
      return true;
    }
    cur =
      typeof cur === "object" ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function round4(n: number): number {
  return Math.max(0, Math.round(n * 10_000) / 10_000);
}

export async function earn(args: EarnArgs): Promise<EarnResult> {
  const { account, actionType, idempotencyKey, metadata } = args;
  const def = ACTION_MAP[actionType];
  const amt = round4(args.amount);
  const amtStr = amt.toFixed(4);

  try {
    const newBalance = await db.transaction(async (tx) => {
      await tx.insert(earnEventsTable).values({
        accountId: account.id,
        actionType,
        amount: amtStr,
        idempotencyKey,
        metadata: metadata ?? null,
      });
      const [updated] = await tx
        .update(rewardAccountsTable)
        .set({ balance: sql`${rewardAccountsTable.balance} + ${amtStr}` })
        .where(eq(rewardAccountsTable.id, account.id))
        .returning({ balance: rewardAccountsTable.balance });
      return updated.balance;
    });

    const emailable = args.emailable ?? def?.emailable ?? false;
    if (emailable && account.email && amt > 0) {
      void maybeEmailEarn(account, def?.label ?? actionType, amt, newBalance, args.emailNote);
    }

    return {
      credited: true,
      alreadyEarned: false,
      amount: amt,
      balance: newBalance,
      message: `+${amt} ForgeRun points earned`,
    };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const [acct] = await db
        .select({ balance: rewardAccountsTable.balance })
        .from(rewardAccountsTable)
        .where(eq(rewardAccountsTable.id, account.id))
        .limit(1);
      return {
        credited: false,
        alreadyEarned: true,
        amount: 0,
        balance: acct?.balance ?? account.balance,
        message: "Already claimed — come back later",
      };
    }
    throw e;
  }
}

// Fail-soft, capped earn notification. Counts today's *emailable* events so a
// flurry of non-emailable mining clicks can't exhaust the cap.
async function maybeEmailEarn(
  account: RewardAccount,
  label: string,
  amount: number,
  balance: string,
  note?: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(earnEventsTable)
      .where(
        and(
          eq(earnEventsTable.accountId, account.id),
          gte(earnEventsTable.createdAt, startOfUtcDay()),
          inArray(earnEventsTable.actionType, EMAILABLE_TYPES),
        ),
      );
    if ((row?.count ?? 0) > DAILY_EMAIL_CAP) return;
    if (!account.email) return;
    await sendEmail({
      to: account.email,
      subject: `+${amount} ForgeRun points earned`,
      html: earnEmail({ label, amount, balance, note }),
    });
  } catch (err) {
    logger.warn({ err }, "earn email failed (non-fatal)");
  }
}

// ---------------------------------------------------------------------------
// Per-account action status (for the dashboard)
// ---------------------------------------------------------------------------
export interface ActionStatusView {
  type: string;
  available: boolean;
  nextAvailableAt: string | null;
  lastEarnedAt: string | null;
}

// events MUST be ordered newest-first.
export function buildActionStatuses(events: EarnEvent[]): ActionStatusView[] {
  const now = Date.now();
  const startDay = startOfUtcDay();
  return ACTIONS.map((def) => {
    const ofType = events.filter((e) => e.actionType === def.type);
    const latest = ofType[0];
    const lastEarnedAt = latest ? latest.createdAt.toISOString() : null;
    let available = true;
    let nextAvailableAt: string | null = null;

    if (def.cadence === "once" || def.cadence === "perTarget") {
      available = ofType.length === 0;
    } else if (def.cadence === "daily") {
      available = !ofType.some((e) => e.createdAt >= startDay);
      if (!available) nextAvailableAt = nextUtcDay().toISOString();
    } else if (def.cadence === "cooldown") {
      if (latest) {
        const next = latest.createdAt.getTime() + MINE_COOLDOWN_SECONDS * 1000;
        available = now >= next;
        if (!available) nextAvailableAt = new Date(next).toISOString();
      }
    }
    return { type: def.type, available, nextAvailableAt, lastEarnedAt };
  });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
export function serializeRewardAccount(a: RewardAccount) {
  return {
    id: a.id,
    walletAddress: a.walletAddress,
    email: a.email,
    handle: a.handle,
    balance: a.balance,
    referralCode: a.referralCode,
    referredByCode: a.referredByCode,
    checkinStreak: a.checkinStreak,
    lastCheckinDate: a.lastCheckinDate,
    createdAt: a.createdAt.toISOString(),
  };
}

export function serializeEarnEvent(e: EarnEvent) {
  return {
    id: e.id,
    actionType: e.actionType,
    amount: e.amount,
    createdAt: e.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Spin wheel (server-side randomness)
// ---------------------------------------------------------------------------
export const SPIN_SEGMENTS = [10, 25, 50, 100, 250, 500];
const SPIN_WEIGHTS = [30, 25, 20, 15, 8, 2];

export function spinAmount(): number {
  const total = SPIN_WEIGHTS.reduce((s, w) => s + w, 0);
  let roll = crypto.randomInt(0, total);
  for (let i = 0; i < SPIN_SEGMENTS.length; i++) {
    roll -= SPIN_WEIGHTS[i];
    if (roll < 0) return SPIN_SEGMENTS[i];
  }
  return SPIN_SEGMENTS[0];
}

// ---------------------------------------------------------------------------
// Quiz (answers server-only)
// ---------------------------------------------------------------------------
export interface QuizQuestion {
  id: number;
  prompt: string;
  choices: string[];
  answer: number;
}

export const QUIZ: QuizQuestion[] = [
  {
    id: 1,
    prompt: "Which NVIDIA GPU is purpose-built for large-scale AI training with HBM memory?",
    choices: ["RTX 3060", "H100", "GTX 1080", "Quadro K620"],
    answer: 1,
  },
  {
    id: 2,
    prompt: "ForgeRun settles GPU rental payments on which blockchain?",
    choices: ["Ethereum", "Bitcoin", "Solana", "Polygon"],
    answer: 2,
  },
  {
    id: 3,
    prompt: "What does 'VRAM' stand for?",
    choices: ["Virtual RAM", "Video Random Access Memory", "Variable RAM", "Vector RAM"],
    answer: 1,
  },
  {
    id: 4,
    prompt: "Which of these is fastest for FP16 deep-learning throughput?",
    choices: ["RTX 4090", "GTX 1660", "RTX 2060", "GT 1030"],
    answer: 0,
  },
  {
    id: 5,
    prompt: "Roughly, 1 SOL equals how many lamports?",
    choices: ["1,000", "1,000,000", "1,000,000,000", "1,000,000,000,000"],
    answer: 2,
  },
];

export function gradeQuiz(answers: number[]): { correct: number; total: number; passed: boolean } {
  let correct = 0;
  for (const q of QUIZ) {
    if (answers[q.id - 1] === q.answer) correct++;
  }
  return { correct, total: QUIZ.length, passed: correct >= QUIZ_PASS };
}

// ---------------------------------------------------------------------------
// Daily trivia (rotates by UTC day; answer server-only)
// ---------------------------------------------------------------------------
export interface TriviaQuestion {
  id: number;
  prompt: string;
  choices: string[];
  answer: number;
}

const TRIVIA_POOL: TriviaQuestion[] = [
  { id: 1, prompt: "Approximately how many CUDA cores does the RTX 4090 have?", choices: ["~4,000", "~10,000", "~16,000", "~24,000"], answer: 2 },
  { id: 2, prompt: "Solana's typical block time is closest to?", choices: ["~10 min", "~12 sec", "~400 ms", "~2 min"], answer: 2 },
  { id: 3, prompt: "Which memory type does the H100 SXM use?", choices: ["GDDR6", "HBM3", "DDR4", "GDDR5"], answer: 1 },
  { id: 4, prompt: "On ForgeRun, GPU rates are quoted in USD/hr and paid in?", choices: ["SOL", "BTC", "ETH", "Points only"], answer: 0 },
  { id: 5, prompt: "Mixed-precision training mostly relies on which formats?", choices: ["FP64", "FP16 / BF16", "INT8 only", "FP128"], answer: 1 },
];

export function todaysTrivia(): TriviaQuestion {
  return TRIVIA_POOL[dayIndex() % TRIVIA_POOL.length];
}

// ---------------------------------------------------------------------------
// Guess the GPU price (reference $/hr; rotates by UTC day)
// ---------------------------------------------------------------------------
const REFERENCE_PRICES: Record<string, number> = {
  "RTX 4090": 0.4,
  H100: 2.49,
  A100: 1.19,
  "RTX 3090": 0.22,
  L40S: 0.89,
};
const GUESS_GPUS = Object.keys(REFERENCE_PRICES);
export const GUESS_MAX_REWARD = 200;

export function todaysGuessGpu(): { gpuModel: string; hint: string } {
  const gpuModel = GUESS_GPUS[dayIndex() % GUESS_GPUS.length];
  return {
    gpuModel,
    hint: "Guess the typical on-demand cloud rate in USD per hour.",
  };
}

export function gradeGuess(
  gpuModel: string,
  guessUsd: number,
): { actualUsd: number; withinPct: number; reward: number } | null {
  const actualUsd = REFERENCE_PRICES[gpuModel];
  if (actualUsd === undefined) return null;
  const withinPct =
    actualUsd > 0 ? Math.abs(guessUsd - actualUsd) / actualUsd : 1;
  let reward = 0;
  if (withinPct <= 0.1) reward = GUESS_MAX_REWARD;
  else if (withinPct <= 0.25) reward = 100;
  else if (withinPct <= 0.5) reward = 50;
  else reward = 10;
  return { actualUsd, withinPct: Math.round(withinPct * 1000) / 1000, reward };
}

// ---------------------------------------------------------------------------
// Product hooks (called from other routes)
// ---------------------------------------------------------------------------
export async function creditFirstRentalByWallet(wallet: string | null): Promise<void> {
  if (!wallet) return;
  const [account] = await db
    .select()
    .from(rewardAccountsTable)
    .where(walletColumnEquals(rewardAccountsTable.walletAddress, wallet))
    .limit(1);
  if (!account) return;
  await earn({
    account,
    actionType: "first_rental",
    amount: FIRST_RENTAL_REWARD,
    idempotencyKey: onceKey(account.id, "first_rental"),
    emailNote: "Thanks for renting your first GPU on ForgeRun — here's a bonus.",
  });
}
