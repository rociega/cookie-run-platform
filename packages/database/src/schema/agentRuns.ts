import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One agent run per rental (1:1). The agent operates entirely inside the
// rental's own instance over a per-run SSH credential that is generated,
// used, and discarded server-side — never written to this table or any other
// persistent store. See agentSsh.ts / agentRunner.ts.
export const agentRunsTable = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  rentalId: integer("rental_id").notNull().unique(),
  payerWallet: text("payer_wallet"),
  // What the user asked the agent to do, and which public repo it works in
  // (mirrors rentals.repository_url/revision at creation time so this row is
  // still legible if the rental changes).
  task: text("task").notNull(),
  repositoryUrl: text("repository_url").notNull(),
  repositoryRevision: text("repository_revision"),
  // queued -> provisioning -> connecting -> running -> completed
  //                                              \-> failed
  //                                              \-> stopped
  status: text("status").notNull().default("queued"),
  stepCount: integer("step_count").notNull().default(0),
  maxSteps: integer("max_steps").notNull().default(30),
  // Append-only human-readable transcript of what the agent did, truncated to
  // a bounded size by the runner before each write.
  log: text("log").notNull().default(""),
  // Unified `git diff` of the working tree once the run finishes, truncated to
  // a bounded size. No push/commit happens automatically (public-repo-only,
  // read-and-propose v1 — see replit.md / product notes on GitHub OAuth).
  diff: text("diff"),
  errorMessage: text("error_message"),
  stopRequested: integer("stop_requested").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertAgentRunSchema = createInsertSchema(agentRunsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentRun = typeof agentRunsTable.$inferSelect;
