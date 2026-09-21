import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, agentRunsTable, rentalsTable, type AgentRun } from "@workspace/db";
import {
  requireAuth,
  currentAccount,
  walletColumnEquals,
  walletIdentitiesMatch,
} from "../lib/walletAuth";

const router: IRouter = Router();

function serializeAgentRun(r: AgentRun) {
  return {
    id: r.id,
    rentalId: r.rentalId,
    task: r.task,
    repositoryUrl: r.repositoryUrl,
    repositoryRevision: r.repositoryRevision,
    status: r.status,
    stepCount: r.stepCount,
    maxSteps: r.maxSteps,
    log: r.log,
    diff: r.diff,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

// Ownership is checked against the wallet bound to the run itself (stamped at
// creation time from the caller's payerWallet input) rather than joining
// through the rental, since an Agent Run's payerWallet is set from the same
// trusted source as the rental's. Falls back to the rental's payerWallet for
// any row created before payerWallet was captured directly on agent_runs.
async function loadOwnedAgentRun(id: number, wallet: string) {
  if (!Number.isInteger(id)) return null;
  const [run] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, id)).limit(1);
  if (!run) return null;
  if (run.payerWallet) {
    return walletIdentitiesMatch(run.payerWallet, wallet) ? run : null;
  }
  const [rental] = await db
    .select({ payerWallet: rentalsTable.payerWallet })
    .from(rentalsTable)
    .where(eq(rentalsTable.id, run.rentalId))
    .limit(1);
  return walletIdentitiesMatch(rental?.payerWallet, wallet) ? run : null;
}

router.get("/agent-runs", requireAuth, async (_req, res): Promise<void> => {
  const wallet = currentAccount(res).walletAddress;
  const rows = await db
    .select()
    .from(agentRunsTable)
    .where(walletColumnEquals(agentRunsTable.payerWallet, wallet))
    .orderBy(desc(agentRunsTable.createdAt));
  res.json(rows.map(serializeAgentRun));
});

router.get("/agent-runs/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const wallet = currentAccount(res).walletAddress;
  const run = await loadOwnedAgentRun(id, wallet);
  if (!run) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeAgentRun(run));
});

router.post("/agent-runs/:id/stop", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const wallet = currentAccount(res).walletAddress;
  const run = await loadOwnedAgentRun(id, wallet);
  if (!run) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [updated] = await db
    .update(agentRunsTable)
    .set({ stopRequested: 1 })
    .where(and(eq(agentRunsTable.id, id), eq(agentRunsTable.rentalId, run.rentalId)))
    .returning();
  res.json(serializeAgentRun(updated));
});

export default router;
