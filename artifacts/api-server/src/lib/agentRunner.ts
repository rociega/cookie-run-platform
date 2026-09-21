// Orchestrates a single Agent Run: waits for its rental's instance to accept
// SSH, then drives a bounded tool-calling loop (read/write files, run shell
// commands) against the checked-out repository, and finally records a diff of
// whatever the agent changed. No commit/push happens here — see agentRuns.ts
// and replit.md for why (raw GitHub tokens are rejected by this platform's
// existing source-credential policy; push-back is future OAuth-gated work).
import { Client as SshClient } from "ssh2";
import { eq } from "drizzle-orm";
import { db, agentRunsTable, type AgentRun } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getInstances, type VastInstanceDetail } from "./vast";
import { getAgentPrivateKey, releaseAgentSshKeypair } from "./agentSsh";
import { logger } from "./logger";

const MAX_STEPS_DEFAULT = 30;
const MAX_WALL_CLOCK_MS = 20 * 60 * 1000; // 20 minutes
const SSH_WAIT_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes for the box to come up
const SSH_POLL_INTERVAL_MS = 5000;
const MAX_LOG_CHARS = 60_000;
const MAX_DIFF_CHARS = 200_000;
const MAX_TOOL_OUTPUT_CHARS = 8000;
const REPO_DIR = "/workspace/repository";
const MODEL = "gpt-5.6-terra";

const activeRunners = new Set<number>(); // rentalId, for a crude single-flight guard

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  return `${head}\n…[truncated ${text.length - max} more characters]`;
}

async function appendLog(rentalId: number, line: string): Promise<void> {
  const [row] = await db
    .select({ log: agentRunsTable.log })
    .from(agentRunsTable)
    .where(eq(agentRunsTable.rentalId, rentalId))
    .limit(1);
  const next = truncate(`${row?.log ?? ""}${line}\n`, MAX_LOG_CHARS);
  await db
    .update(agentRunsTable)
    .set({ log: next })
    .where(eq(agentRunsTable.rentalId, rentalId));
}

async function setStatus(
  rentalId: number,
  status: AgentRun["status"],
  extra: Partial<Pick<AgentRun, "errorMessage" | "diff" | "stepCount">> = {},
): Promise<void> {
  await db
    .update(agentRunsTable)
    .set({
      status,
      ...extra,
      ...(status === "completed" || status === "failed" || status === "stopped"
        ? { completedAt: new Date() }
        : {}),
    })
    .where(eq(agentRunsTable.rentalId, rentalId));
}

async function isStopRequested(rentalId: number): Promise<boolean> {
  const [row] = await db
    .select({ stopRequested: agentRunsTable.stopRequested })
    .from(agentRunsTable)
    .where(eq(agentRunsTable.rentalId, rentalId))
    .limit(1);
  return (row?.stopRequested ?? 0) > 0;
}

async function waitForSshTarget(
  vastInstanceId: string,
): Promise<{ host: string; port: number }> {
  const deadline = Date.now() + SSH_WAIT_TIMEOUT_MS;
  for (;;) {
    const instances = await getInstances().catch(() => [] as VastInstanceDetail[]);
    const inst = instances.find((i) => i.id === vastInstanceId);
    if (inst?.sshHost && inst.sshPort != null) {
      return { host: inst.sshHost, port: Number(inst.sshPort) };
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the instance to expose SSH.");
    }
    await new Promise((r) => setTimeout(r, SSH_POLL_INTERVAL_MS));
  }
}

function connectSsh(
  host: string,
  port: number,
  privateKey: string,
): Promise<SshClient> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    const onReady = () => {
      client.removeListener("error", onError);
      resolve(client);
    };
    const onError = (err: Error) => {
      client.removeListener("ready", onReady);
      reject(err);
    };
    client.once("ready", onReady);
    client.once("error", onError);
    client.connect({
      host,
      port,
      username: "root",
      privateKey,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
    });
  });
}

function exec(client: SshClient, command: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let output = "";
      stream.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      stream.on("close", (code: number | null) => {
        resolve({ code, output });
      });
      stream.on("error", reject);
    });
  });
}

// Waits (briefly) for sshd itself to start accepting connections once the
// host:port is known — the Vast instance can report connection details before
// the container's sshd is actually up.
async function connectWithRetry(
  host: string,
  port: number,
  privateKey: string,
): Promise<SshClient> {
  const deadline = Date.now() + 2 * 60 * 1000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await connectSsh(host, port, privateKey);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not open an SSH connection.");
}

const TOOLS: OpenAI_Tool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file's contents, relative to the repository root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Overwrite (or create) a UTF-8 text file, relative to the repository root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files under a directory, relative to the repository root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Defaults to the repository root." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Run a shell command inside the repository directory (e.g. to run tests, install packages, or inspect code). Runs as root.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

// Minimal local alias so this file doesn't need to import OpenAI's namespace
// types just for the tool schema shape.
type OpenAI_Tool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runTool(
  client: SshClient,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "read_file") {
    const path = String(args.path ?? "");
    const { code, output } = await exec(
      client,
      `cat ${shellQuote(`${REPO_DIR}/${path}`)} 2>&1`,
    );
    return truncate(output, MAX_TOOL_OUTPUT_CHARS) + (code ? `\n(exit ${code})` : "");
  }
  if (name === "write_file") {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    const target = `${REPO_DIR}/${path}`;
    const heredocTag = "FORGERUN_AGENT_EOF";
    const command = [
      `mkdir -p $(dirname ${shellQuote(target)})`,
      `cat > ${shellQuote(target)} << '${heredocTag}'\n${content}\n${heredocTag}`,
    ].join(" && ");
    const { code, output } = await exec(client, command);
    return code === 0 || code === null ? "OK" : truncate(output, MAX_TOOL_OUTPUT_CHARS);
  }
  if (name === "list_dir") {
    const path = String(args.path ?? "");
    const { output } = await exec(
      client,
      `ls -la ${shellQuote(`${REPO_DIR}/${path || "."}`)} 2>&1`,
    );
    return truncate(output, MAX_TOOL_OUTPUT_CHARS);
  }
  if (name === "run_shell") {
    const command = String(args.command ?? "");
    const { code, output } = await exec(
      client,
      `cd ${shellQuote(REPO_DIR)} && ${command} 2>&1`,
    );
    return truncate(output, MAX_TOOL_OUTPUT_CHARS) + `\n(exit ${code ?? "unknown"})`;
  }
  return `Unknown tool: ${name}`;
}

export function runAgentTask(rentalId: number, vastInstanceId: string): void {
  if (activeRunners.has(rentalId)) return;
  activeRunners.add(rentalId);
  void executeAgentTask(rentalId, vastInstanceId)
    .catch((err) => {
      logger.error({ err, rentalId }, "agent-run: unhandled failure");
    })
    .finally(() => {
      activeRunners.delete(rentalId);
      releaseAgentSshKeypair(rentalId);
    });
}

async function executeAgentTask(rentalId: number, vastInstanceId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.rentalId, rentalId))
    .limit(1);
  if (!run || run.status !== "queued") return;

  const deadline = Date.now() + MAX_WALL_CLOCK_MS;
  let client: SshClient | null = null;
  try {
    await setStatus(rentalId, "provisioning");
    const privateKey = getAgentPrivateKey(rentalId);
    if (!privateKey) throw new Error("The agent's SSH credential expired before it could connect.");

    const target = await waitForSshTarget(vastInstanceId);
    await setStatus(rentalId, "connecting");
    client = await connectWithRetry(target.host, target.port, privateKey);

    // The repository is cloned by the same onstart bootstrap every workspace
    // uses; give it a little room to finish before the agent starts working.
    await exec(
      client,
      `for i in $(seq 1 30); do [ -d ${shellQuote(REPO_DIR)}/.git ] && exit 0; sleep 2; done; exit 1`,
    );

    await setStatus(rentalId, "running");
    await appendLog(rentalId, `Connected. Starting on task:\n${run.task}`);

    const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: unknown }> = [
      {
        role: "system",
        content: [
          "You are ForgeRun's coding agent, working autonomously inside a rented Linux workspace.",
          `The repository is checked out at ${REPO_DIR}. Use the provided tools to read and edit files and run shell commands (tests, linters, build tools) to accomplish the task.`,
          "Work efficiently: make the smallest set of changes that satisfy the task, verify your changes when practical (e.g. run relevant tests), and stop once the task is done.",
          "You cannot commit or push — a human will review your diff afterward. Do not attempt git commit/push.",
          "When you believe the task is complete, reply with a short plain-text summary of what you changed and stop calling tools.",
        ].join("\n"),
      },
      { role: "user", content: run.task },
    ];

    const maxSteps = run.maxSteps || MAX_STEPS_DEFAULT;
    let stepCount = 0;
    let stopped = false;

    while (stepCount < maxSteps) {
      if (Date.now() > deadline) {
        await appendLog(rentalId, "Stopping: reached the time budget for this run.");
        break;
      }
      if (await isStopRequested(rentalId)) {
        stopped = true;
        await appendLog(rentalId, "Stop requested by user.");
        break;
      }

      const completion = await openai.chat.completions.create({
        model: MODEL,
        max_completion_tokens: 4096,
        messages: messages as never,
        tools: TOOLS as never,
      });
      const choice = completion.choices[0];
      const message = choice?.message;
      if (!message) break;

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
      } as never);

      if (message.content) {
        await appendLog(rentalId, `Agent: ${truncate(message.content, 2000)}`);
      }

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) break; // model considers the task done

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        stepCount += 1;
        const fnName = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* malformed args from the model; runTool will just no-op sensibly */
        }
        await appendLog(
          rentalId,
          `Step ${stepCount}/${maxSteps}: ${fnName}(${truncate(JSON.stringify(args), 300)})`,
        );
        let result: string;
        try {
          result = await runTool(client, fnName, args);
        } catch (err) {
          result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
        await db
          .update(agentRunsTable)
          .set({ stepCount })
          .where(eq(agentRunsTable.rentalId, rentalId));
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: truncate(result, MAX_TOOL_OUTPUT_CHARS),
        } as never);
      }
    }

    const { output: diff } = await exec(client, `cd ${shellQuote(REPO_DIR)} && git diff 2>&1`);

    if (stopped) {
      await setStatus(rentalId, "stopped", { diff: truncate(diff, MAX_DIFF_CHARS), stepCount });
      await appendLog(rentalId, "Run stopped.");
    } else {
      await setStatus(rentalId, "completed", { diff: truncate(diff, MAX_DIFF_CHARS), stepCount });
      await appendLog(rentalId, "Run finished. Review the diff before applying it.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent run failed unexpectedly.";
    logger.error({ err, rentalId }, "agent-run: failed");
    await appendLog(rentalId, `Failed: ${message}`);
    await setStatus(rentalId, "failed", { errorMessage: message });
  } finally {
    client?.end();
  }
}
