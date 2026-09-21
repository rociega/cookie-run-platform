// Hackathon-style technical missions: unlike CHALLENGES (lib/challenges.ts),
// these have no server-checkable eligibility. A user builds something real
// against our servers (API, SSH, workspace images) and submits a link and/or
// a write-up as proof; an operator reviews and manually pays out the reward.
// This module never credits ICPX balance or moves funds — it only records
// submissions and their review state.
import { and, eq } from "drizzle-orm";
import {
  db,
  missionSubmissionsTable,
  type RewardAccount,
  type MissionSubmission,
} from "@workspace/db";

export interface MissionDef {
  key: string;
  order: number; // 1 (grand prize) .. 10 (easiest entry point)
  title: string;
  description: string;
  rewardNote: string;
}

export const MISSIONS: MissionDef[] = [
  {
    key: "api_explorer",
    order: 10,
    title: "API explorer",
    description:
      "Write a script that calls our public API (list GPUs, check payment config, poll a workspace) and share the code.",
    rewardNote: "Tier 10 reward — details announced at event close.",
  },
  {
    key: "ssh_toolkit",
    order: 9,
    title: "SSH toolkit",
    description:
      "Build a small CLI or shell tool that manages a rented workspace over SSH: start a job, stream logs, and shut it down cleanly.",
    rewardNote: "Tier 9 reward — details announced at event close.",
  },
  {
    key: "custom_image",
    order: 8,
    title: "Custom image",
    description:
      "Publish a container image or repository that others can launch as a ready-to-run workspace template.",
    rewardNote: "Tier 8 reward — details announced at event close.",
  },
  {
    key: "automation_pipeline",
    order: 7,
    title: "Automation pipeline",
    description:
      "Write a script or bot that provisions a workspace, runs a task, and tears the workspace down again unattended.",
    rewardNote: "Tier 7 reward — details announced at event close.",
  },
  {
    key: "benchmark_runner",
    order: 6,
    title: "Benchmark runner",
    description:
      "Run a reproducible GPU benchmark on a rented workspace and publish the methodology and results.",
    rewardNote: "Tier 6 reward — details announced at event close.",
  },
  {
    key: "cost_tracker",
    order: 5,
    title: "Cost tracker",
    description:
      "Build a small tool that uses the API to estimate or track GPU spend across rentals.",
    rewardNote: "Tier 5 reward — details announced at event close.",
  },
  {
    key: "terminal_extension",
    order: 4,
    title: "Terminal extension",
    description:
      "Build a terminal enhancement for the workspace SSH session, such as a monitoring dashboard, tmux layout, or log viewer.",
    rewardNote: "Tier 4 reward — details announced at event close.",
  },
  {
    key: "bug_hunter",
    order: 3,
    title: "Bug hunter",
    description:
      "Find and responsibly report a reproducible platform bug, with clear steps to reproduce it.",
    rewardNote: "Tier 3 reward — details announced at event close.",
  },
  {
    key: "tutorial_author",
    order: 2,
    title: "Tutorial author",
    description:
      "Write a tutorial or guide that walks through doing something useful on a rented workspace, from setup to result.",
    rewardNote: "Tier 2 reward — details announced at event close.",
  },
  {
    key: "grand_build",
    order: 1,
    title: "Grand build",
    description:
      "Ship an end-to-end project built entirely on a rented workspace, such as a trained model or a running inference service. Grand prize — the single largest reward of the event.",
    rewardNote: "Grand prize — the single largest reward of the event.",
  },
];

export const MISSION_MAP: Record<string, MissionDef> = Object.fromEntries(
  MISSIONS.map((m) => [m.key, m]),
);

export interface MissionView {
  key: string;
  order: number;
  title: string;
  description: string;
  rewardNote: string;
  myStatus: "pending" | "approved" | "rejected" | null;
  myProofUrl: string | null;
  myWriteup: string | null;
  myReviewNote: string | null;
}

export async function buildMissionViews(account: RewardAccount | null): Promise<MissionView[]> {
  const mine = account
    ? await db
        .select()
        .from(missionSubmissionsTable)
        .where(eq(missionSubmissionsTable.accountId, account.id))
    : [];
  const byKey = new Map(mine.map((s) => [s.missionKey, s]));

  return [...MISSIONS]
    .sort((a, b) => b.order - a.order)
    .map((def) => {
      const submission = byKey.get(def.key);
      return {
        key: def.key,
        order: def.order,
        title: def.title,
        description: def.description,
        rewardNote: def.rewardNote,
        myStatus: (submission?.status as MissionView["myStatus"]) ?? null,
        myProofUrl: submission?.proofUrl ?? null,
        myWriteup: submission?.writeup ?? null,
        myReviewNote: submission?.reviewNote ?? null,
      };
    });
}

export type SubmitMissionOutcome =
  | { ok: true; submission: MissionSubmission }
  | { ok: false; reason: string };

export async function submitMission(
  account: RewardAccount,
  missionKey: string,
  proofUrl: string | null,
  writeup: string | null,
): Promise<SubmitMissionOutcome> {
  const def = MISSION_MAP[missionKey];
  if (!def) return { ok: false, reason: "Unknown mission" };
  if (!proofUrl && !writeup) {
    return { ok: false, reason: "Submit a link, a write-up, or both." };
  }

  const [existing] = await db
    .select()
    .from(missionSubmissionsTable)
    .where(
      and(
        eq(missionSubmissionsTable.missionKey, missionKey),
        eq(missionSubmissionsTable.accountId, account.id),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status === "approved") {
      return { ok: false, reason: "This mission is already approved." };
    }
    if (existing.status === "pending") {
      return { ok: false, reason: "Your submission for this mission is still under review." };
    }
    // Rejected — allow resubmission, reset to pending for re-review.
    const [updated] = await db
      .update(missionSubmissionsTable)
      .set({
        proofUrl,
        writeup,
        status: "pending",
        reviewNote: null,
        submittedAt: new Date(),
        reviewedAt: null,
      })
      .where(eq(missionSubmissionsTable.id, existing.id))
      .returning();
    return { ok: true, submission: updated };
  }

  const [created] = await db
    .insert(missionSubmissionsTable)
    .values({
      missionKey,
      accountId: account.id,
      proofUrl,
      writeup,
      rewardNote: def.rewardNote,
    })
    .returning();
  return { ok: true, submission: created };
}

export type ReviewMissionOutcome =
  | { ok: true; submission: MissionSubmission }
  | { ok: false; reason: string };

export async function reviewMissionSubmission(
  submissionId: number,
  status: "approved" | "rejected",
  reviewNote: string | null,
): Promise<ReviewMissionOutcome> {
  const [row] = await db
    .select()
    .from(missionSubmissionsTable)
    .where(eq(missionSubmissionsTable.id, submissionId))
    .limit(1);
  if (!row) return { ok: false, reason: "Submission not found" };

  const [updated] = await db
    .update(missionSubmissionsTable)
    .set({ status, reviewNote, reviewedAt: new Date() })
    .where(eq(missionSubmissionsTable.id, submissionId))
    .returning();
  return { ok: true, submission: updated };
}
