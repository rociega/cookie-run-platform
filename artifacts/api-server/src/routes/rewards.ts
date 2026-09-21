import { Router, type IRouter } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, rewardAccountsTable, earnEventsTable, stakesTable, challengeClaimsTable, missionSubmissionsTable } from "@workspace/db";
import {
  UpdateRewardProfileBody,
  SubmitQuizBody,
  SubmitTriviaBody,
  SubmitPriceGuessBody,
  ClaimSocialBody,
} from "@workspace/api-zod";
import {
  requireAuth,
  currentAccount,
  readSession,
  walletColumnEquals,
} from "../lib/walletAuth";
import { buildChallengeViews, claimChallenge } from "../lib/challenges";
import { buildMissionViews, submitMission, reviewMissionSubmission } from "../lib/missions";
import { ADMIN_EMAIL } from "../lib/config";
import {
  ACTIONS,
  ACTION_MAP,
  SOCIAL_PLATFORMS,
  SPIN_SEGMENTS,
  QUIZ,
  QUIZ_REWARD,
  QUIZ_PASS,
  TRIVIA_REWARD,
  CHECKIN_BASE,
  CHECKIN_STREAK_BONUS,
  CHECKIN_MAX_BONUS,
  MINE_AMOUNT,
  MINE_COOLDOWN_SECONDS,
  MINE_DAILY_CAP,
  type EarnResult,
  earn,
  buildActionStatuses,
  serializeRewardAccount,
  serializeEarnEvent,
  spinAmount,
  gradeQuiz,
  gradeGuess,
  todaysTrivia,
  todaysGuessGpu,
  startOfUtcDay,
  nextUtcDay,
  utcDateKey,
  onceKey,
  dailyKey,
  cooldownKey,
} from "../lib/rewards";

const router: IRouter = Router();

function maskWallet(addr: string): string {
  return addr.length > 8 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function notCredited(message: string, balance: string): EarnResult {
  return { credited: false, alreadyEarned: false, amount: 0, balance, message };
}

// --- Public ---------------------------------------------------------------

router.get("/rewards/actions", (_req, res): void => {
  res.json(
    ACTIONS.map((a) => ({
      type: a.type,
      label: a.label,
      description: a.description,
      category: a.category,
      amount: a.amount,
      cadence: a.cadence,
      emailable: a.emailable,
    })),
  );
});

router.get("/rewards/leaderboard", async (_req, res): Promise<void> => {
  // Rank by total ForgeRun points = liquid balance + active staked principal, so staking
  // (which moves balance into locked stakes) never demotes a user.
  const stakeSum = db
    .select({
      accountId: stakesTable.accountId,
      locked: sql<string>`coalesce(sum(${stakesTable.amount}), 0)`.as("locked"),
    })
    .from(stakesTable)
    .where(eq(stakesTable.status, "active"))
    .groupBy(stakesTable.accountId)
    .as("stake_sum");

  const total = sql<string>`(${rewardAccountsTable.balance} + coalesce(${stakeSum.locked}, 0))`;
  const rows = await db
    .select({
      walletAddress: rewardAccountsTable.walletAddress,
      handle: rewardAccountsTable.handle,
      total,
    })
    .from(rewardAccountsTable)
    .leftJoin(stakeSum, eq(stakeSum.accountId, rewardAccountsTable.id))
    .orderBy(desc(total))
    .limit(20);
  res.json(
    rows.map((r, i) => ({
      rank: i + 1,
      name: r.handle || maskWallet(r.walletAddress),
      balance: r.total,
    })),
  );
});

// --- Authenticated --------------------------------------------------------

router.get("/rewards/me", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  res.setHeader("Cache-Control", "private, no-store");
  const events = await db
    .select()
    .from(earnEventsTable)
    .where(eq(earnEventsTable.accountId, account.id))
    .orderBy(desc(earnEventsTable.createdAt));
  res.json({
    account: serializeRewardAccount(account),
    actions: buildActionStatuses(events),
    history: events.slice(0, 20).map(serializeEarnEvent),
  });
});

router.get("/rewards/games", requireAuth, (_req, res): void => {
  res.setHeader("Cache-Control", "private, no-store");
  const trivia = todaysTrivia();
  res.json({
    quiz: {
      questions: QUIZ.map((q) => ({ id: q.id, prompt: q.prompt, choices: q.choices })),
    },
    trivia: { id: trivia.id, prompt: trivia.prompt, choices: trivia.choices },
    guess: todaysGuessGpu(),
  });
});

router.post("/rewards/profile", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const parsed = UpdateRewardProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile fields" });
    return;
  }
  const { handle, email } = parsed.data;
  const updates: { handle?: string; email?: string } = {};
  if (handle !== undefined) updates.handle = handle;
  if (email !== undefined) updates.email = email;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide a handle or email to update" });
    return;
  }

  const [updated] = await db
    .update(rewardAccountsTable)
    .set(updates)
    .where(eq(rewardAccountsTable.id, account.id))
    .returning();

  // First-time bonuses.
  if (handle && !account.handle) {
    await earn({
      account: updated,
      actionType: "complete_profile",
      amount: ACTION_MAP.complete_profile.amount,
      idempotencyKey: onceKey(account.id, "complete_profile"),
    });
  }
  if (email && !account.email) {
    await earn({
      account: updated,
      actionType: "add_email",
      amount: ACTION_MAP.add_email.amount,
      idempotencyKey: onceKey(account.id, "add_email"),
      emailNote: "Your ForgeRun rewards email is set — you'll get a note on every earn.",
    });
  }

  const [fresh] = await db
    .select()
    .from(rewardAccountsTable)
    .where(eq(rewardAccountsTable.id, account.id))
    .limit(1);
  res.json(serializeRewardAccount(fresh));
});

router.post("/rewards/checkin", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  const today = utcDateKey();
  const yesterday = utcDateKey(new Date(Date.now() - 86_400_000));

  let newStreak: number;
  if (account.lastCheckinDate === today) newStreak = account.checkinStreak;
  else if (account.lastCheckinDate === yesterday) newStreak = account.checkinStreak + 1;
  else newStreak = 1;

  const bonus = Math.min((newStreak - 1) * CHECKIN_STREAK_BONUS, CHECKIN_MAX_BONUS);
  const amount = CHECKIN_BASE + bonus;

  const result = await earn({
    account,
    actionType: "daily_checkin",
    amount,
    idempotencyKey: dailyKey(account.id, "daily_checkin"),
    metadata: { streak: newStreak },
    emailNote: `Day ${newStreak} streak — keep it going!`,
  });

  if (result.credited) {
    await db
      .update(rewardAccountsTable)
      .set({ checkinStreak: newStreak, lastCheckinDate: today })
      .where(eq(rewardAccountsTable.id, account.id));
  }

  res.json({ earn: result, streak: result.credited ? newStreak : account.checkinStreak });
});

router.post("/rewards/spin", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  const amount = spinAmount();
  const result = await earn({
    account,
    actionType: "spin_wheel",
    amount,
    idempotencyKey: dailyKey(account.id, "spin_wheel"),
    emailNote: `The wheel landed on ${amount} ForgeRun points.`,
  });
  res.json({
    earn: result,
    amount: result.credited ? amount : 0,
    segments: SPIN_SEGMENTS,
  });
});

router.post("/rewards/quiz", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const parsed = SubmitQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid quiz submission" });
    return;
  }
  const grade = gradeQuiz(parsed.data.answers);
  let earnResult: EarnResult;
  if (grade.passed) {
    earnResult = await earn({
      account,
      actionType: "gpu_quiz",
      amount: QUIZ_REWARD,
      idempotencyKey: onceKey(account.id, "gpu_quiz"),
      emailNote: `You passed the GPU quiz (${grade.correct}/${grade.total}).`,
    });
  } else {
    earnResult = notCredited(
      `Scored ${grade.correct}/${grade.total} — get ${QUIZ_PASS} right to earn.`,
      account.balance,
    );
  }
  res.json({
    correct: grade.correct,
    total: grade.total,
    passed: grade.passed,
    earn: earnResult,
  });
});

router.post("/rewards/trivia", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const parsed = SubmitTriviaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trivia submission" });
    return;
  }
  const trivia = todaysTrivia();
  const correct = parsed.data.choice === trivia.answer;
  let earnResult: EarnResult;
  if (correct) {
    earnResult = await earn({
      account,
      actionType: "daily_trivia",
      amount: TRIVIA_REWARD,
      idempotencyKey: dailyKey(account.id, "daily_trivia"),
      emailNote: "Correct — daily trivia bonus claimed.",
    });
  } else {
    earnResult = notCredited("Not quite — give it another try.", account.balance);
  }
  res.json({ correct, earn: earnResult });
});

router.post("/rewards/guess", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const parsed = SubmitPriceGuessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid guess" });
    return;
  }
  const { gpuModel, guessUsd } = parsed.data;
  if (gpuModel !== todaysGuessGpu().gpuModel) {
    res.status(400).json({ error: "That is not today's GPU" });
    return;
  }
  const graded = gradeGuess(gpuModel, guessUsd);
  if (!graded) {
    res.status(400).json({ error: "Unknown GPU" });
    return;
  }
  const earnResult = await earn({
    account,
    actionType: "guess_gpu_price",
    amount: graded.reward,
    idempotencyKey: dailyKey(account.id, "guess_gpu_price"),
    emailNote: `Your ${gpuModel} guess was within ${Math.round(graded.withinPct * 100)}%.`,
  });
  res.json({
    actualUsd: graded.actualUsd.toFixed(2),
    withinPct: graded.withinPct,
    earn: earnResult,
  });
});

router.post("/rewards/mine", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  const now = Date.now();

  const [latest] = await db
    .select({ createdAt: earnEventsTable.createdAt })
    .from(earnEventsTable)
    .where(
      and(
        eq(earnEventsTable.accountId, account.id),
        eq(earnEventsTable.actionType, "click_to_mine"),
      ),
    )
    .orderBy(desc(earnEventsTable.createdAt))
    .limit(1);

  if (latest) {
    const next = latest.createdAt.getTime() + MINE_COOLDOWN_SECONDS * 1000;
    if (now < next) {
      res.json({
        earn: notCredited("Rig is cooling down — try again shortly.", account.balance),
        cooldownSeconds: MINE_COOLDOWN_SECONDS,
        nextAvailableAt: new Date(next).toISOString(),
      });
      return;
    }
  }

  const [cap] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(earnEventsTable)
    .where(
      and(
        eq(earnEventsTable.accountId, account.id),
        eq(earnEventsTable.actionType, "click_to_mine"),
        gte(earnEventsTable.createdAt, startOfUtcDay()),
      ),
    );
  if ((cap?.count ?? 0) >= MINE_DAILY_CAP) {
    res.json({
      earn: notCredited("Daily mining cap reached — back tomorrow.", account.balance),
      cooldownSeconds: MINE_COOLDOWN_SECONDS,
      nextAvailableAt: nextUtcDay().toISOString(),
    });
    return;
  }

  const result = await earn({
    account,
    actionType: "click_to_mine",
    amount: MINE_AMOUNT,
    idempotencyKey: cooldownKey(account.id, "click_to_mine", MINE_COOLDOWN_SECONDS),
  });
  res.json({
    earn: result,
    cooldownSeconds: MINE_COOLDOWN_SECONDS,
    nextAvailableAt: new Date(now + MINE_COOLDOWN_SECONDS * 1000).toISOString(),
  });
});

router.post("/rewards/social", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const parsed = ClaimSocialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid platform" });
    return;
  }
  const actionType = SOCIAL_PLATFORMS[parsed.data.platform];
  const def = actionType ? ACTION_MAP[actionType] : undefined;
  if (!def) {
    res.status(400).json({ error: "Unknown platform" });
    return;
  }
  const key =
    def.cadence === "daily"
      ? dailyKey(account.id, actionType)
      : onceKey(account.id, actionType);
  const result = await earn({
    account,
    actionType,
    amount: def.amount,
    idempotencyKey: key,
    emailNote: `Thanks for supporting ForgeRun (${def.label}).`,
  });
  res.json(result);
});

// --- Launch event: 10 challenges --------------------------------------
//
// Rewards for these are paid out MANUALLY by an operator, not credited
// automatically — claiming only reserves a slot and records intent.

router.get("/rewards/challenges", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  let account = null;
  if (token) {
    // Best-effort: an expired/missing token just means an anonymous view.
    const wallet = readSession(token);
    if (wallet) {
      const [row] = await db
        .select()
        .from(rewardAccountsTable)
        .where(walletColumnEquals(rewardAccountsTable.walletAddress, wallet))
        .limit(1);
      account = row ?? null;
    }
  }
  res.json(await buildChallengeViews(account));
});

router.post("/rewards/challenges/:key/claim", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const outcome = await claimChallenge(account, String(req.params.key));
  if (!outcome.ok) {
    res.status(400).json({ error: outcome.reason });
    return;
  }
  res.json({ claimed: true, rank: outcome.rank });
});

// Operator view of who claimed what, for manual reward payout. Gated on the
// authenticated account's email matching ICPX_ADMIN_EMAIL — there is no
// broader admin role system in this app.
router.get("/rewards/challenges/admin/claims", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  if (!ADMIN_EMAIL || account.email !== ADMIN_EMAIL) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const rows = await db
    .select({
      id: challengeClaimsTable.id,
      challengeKey: challengeClaimsTable.challengeKey,
      rank: challengeClaimsTable.rank,
      rewardNote: challengeClaimsTable.rewardNote,
      payoutStatus: challengeClaimsTable.payoutStatus,
      claimedAt: challengeClaimsTable.claimedAt,
      walletAddress: rewardAccountsTable.walletAddress,
      handle: rewardAccountsTable.handle,
      email: rewardAccountsTable.email,
    })
    .from(challengeClaimsTable)
    .innerJoin(rewardAccountsTable, eq(rewardAccountsTable.id, challengeClaimsTable.accountId))
    .orderBy(desc(challengeClaimsTable.challengeKey), challengeClaimsTable.rank);
  res.json(
    rows.map((r) => ({ ...r, claimedAt: r.claimedAt.toISOString() })),
  );
});

// --- Launch event: 10 hackathon-style technical missions ---------------
//
// No server-checkable eligibility here — a user submits a link and/or a
// write-up as proof, and rewards are paid out MANUALLY by an operator after
// review, same policy as the challenges above.

router.get("/rewards/missions", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  let account = null;
  if (token) {
    // Best-effort: an expired/missing token just means an anonymous view.
    const wallet = readSession(token);
    if (wallet) {
      const [row] = await db
        .select()
        .from(rewardAccountsTable)
        .where(walletColumnEquals(rewardAccountsTable.walletAddress, wallet))
        .limit(1);
      account = row ?? null;
    }
  }
  res.json(await buildMissionViews(account));
});

router.post("/rewards/missions/:key/submit", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const proofUrl = typeof req.body?.proofUrl === "string" ? req.body.proofUrl.trim() || null : null;
  const writeup = typeof req.body?.writeup === "string" ? req.body.writeup.trim() || null : null;
  const outcome = await submitMission(account, String(req.params.key), proofUrl, writeup);
  if (!outcome.ok) {
    res.status(400).json({ error: outcome.reason });
    return;
  }
  res.json({ submitted: true, status: "pending" });
});

// Operator view of every mission submission, for manual review and reward
// payout. Gated the same way as the challenges admin view: the authenticated
// account's email must match ICPX_ADMIN_EMAIL.
router.get("/rewards/missions/admin/submissions", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  if (!ADMIN_EMAIL || account.email !== ADMIN_EMAIL) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const rows = await db
    .select({
      id: missionSubmissionsTable.id,
      missionKey: missionSubmissionsTable.missionKey,
      proofUrl: missionSubmissionsTable.proofUrl,
      writeup: missionSubmissionsTable.writeup,
      status: missionSubmissionsTable.status,
      reviewNote: missionSubmissionsTable.reviewNote,
      rewardNote: missionSubmissionsTable.rewardNote,
      payoutStatus: missionSubmissionsTable.payoutStatus,
      submittedAt: missionSubmissionsTable.submittedAt,
      reviewedAt: missionSubmissionsTable.reviewedAt,
      walletAddress: rewardAccountsTable.walletAddress,
      handle: rewardAccountsTable.handle,
      email: rewardAccountsTable.email,
    })
    .from(missionSubmissionsTable)
    .innerJoin(rewardAccountsTable, eq(rewardAccountsTable.id, missionSubmissionsTable.accountId))
    .orderBy(desc(missionSubmissionsTable.submittedAt));
  res.json(
    rows.map((r) => ({
      ...r,
      submittedAt: r.submittedAt.toISOString(),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    })),
  );
});

router.post(
  "/rewards/missions/admin/submissions/:id/review",
  requireAuth,
  async (req, res): Promise<void> => {
    const account = currentAccount(res);
    if (!ADMIN_EMAIL || account.email !== ADMIN_EMAIL) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const status = req.body?.status;
    if (status !== "approved" && status !== "rejected") {
      res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
      return;
    }
    const reviewNote = typeof req.body?.reviewNote === "string" ? req.body.reviewNote.trim() || null : null;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid submission id" });
      return;
    }
    const outcome = await reviewMissionSubmission(id, status, reviewNote);
    if (!outcome.ok) {
      res.status(400).json({ error: outcome.reason });
      return;
    }
    const [row] = await db
      .select({
        id: missionSubmissionsTable.id,
        missionKey: missionSubmissionsTable.missionKey,
        proofUrl: missionSubmissionsTable.proofUrl,
        writeup: missionSubmissionsTable.writeup,
        status: missionSubmissionsTable.status,
        reviewNote: missionSubmissionsTable.reviewNote,
        rewardNote: missionSubmissionsTable.rewardNote,
        payoutStatus: missionSubmissionsTable.payoutStatus,
        submittedAt: missionSubmissionsTable.submittedAt,
        reviewedAt: missionSubmissionsTable.reviewedAt,
        walletAddress: rewardAccountsTable.walletAddress,
        handle: rewardAccountsTable.handle,
        email: rewardAccountsTable.email,
      })
      .from(missionSubmissionsTable)
      .innerJoin(rewardAccountsTable, eq(rewardAccountsTable.id, missionSubmissionsTable.accountId))
      .where(eq(missionSubmissionsTable.id, id))
      .limit(1);
    res.json({
      ...row,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    });
  },
);

export default router;
