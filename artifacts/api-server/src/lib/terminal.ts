// In-browser SSH terminal bridge.
//
// Browsers cannot speak raw SSH, so this bridges a WebSocket <-> a real SSH
// connection to the user's rented Vast.ai GPU. The WS shares the API server's
// single HTTP port (and thus the /api proxy path) via an "upgrade" listener.
//
// Security model:
//   - WS upgrades bypass Express middleware, so auth is a one-time ticket minted
//     by the authed REST endpoint (see terminalTickets.ts), consumed exactly once
//     at upgrade. Bearer tokens are never placed in the URL.
//   - The SSH target is resolved SERVER-SIDE from the workspace's provider instance id
//     (never from client input) — only the Vast-reported sshHost:sshPort is ever
//     dialed, which prevents SSRF to arbitrary hosts.
//   - The private key is supplied by the client as the first WS frame, held in
//     memory only for the lifetime of the connection, never logged or persisted,
//     and cleared on close.
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import { eq } from "drizzle-orm";
import { db, rentalsTable } from "@workspace/db";
import { getInstances } from "./vast";
import { walletIdentitiesMatch } from "./walletAuth";
import { consumeTerminalTicket } from "./terminalTickets";
import { logger } from "./logger";

const MAX_PAYLOAD = 64 * 1024;
const MAX_SESSIONS_PER_WALLET = 2;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SESSION_MS = 4 * 60 * 60 * 1000;
const AUTH_FRAME_TIMEOUT_MS = 30 * 1000;
const BACKPRESSURE_HIGH = 1024 * 1024; // pause ssh -> ws above 1MB buffered
const BACKPRESSURE_LOW = 256 * 1024; // resume below 256KB
const MAX_PENDING_FRAMES = 16; // frames buffered before the ssh target resolves

const TERMINAL_PATH = /^\/api\/(?:workspaces|rentals)\/(\d+)\/terminal$/;

// Active terminal sessions per wallet, for the concurrency cap.
const sessionsByWallet = new Map<string, number>();

function bumpSessions(wallet: string, delta: number): void {
  const next = (sessionsByWallet.get(wallet) ?? 0) + delta;
  if (next <= 0) sessionsByWallet.delete(wallet);
  else sessionsByWallet.set(wallet, next);
}

function rejectUpgrade(socket: Duplex, code: number, message: string): void {
  socket.write(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

// Client -> server control frames (small; keystrokes wrapped in JSON). Server ->
// client is raw binary terminal output for efficiency.
interface AuthFrame {
  type: "auth";
  privateKey: string;
  passphrase?: string;
  cols?: number;
  rows?: number;
}
interface DataFrame {
  type: "data";
  data: string;
}
interface ResizeFrame {
  type: "resize";
  cols: number;
  rows: number;
}
type ClientFrame = AuthFrame | DataFrame | ResizeFrame;

function parseFrame(raw: string): ClientFrame | null {
  try {
    const obj = JSON.parse(raw) as ClientFrame;
    if (obj && typeof obj === "object" && typeof obj.type === "string") return obj;
  } catch {
    /* malformed */
  }
  return null;
}

function clampDimension(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? Math.floor(value) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 1000);
}

function sendNotice(ws: WebSocket, text: string): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(`\r\n${text}\r\n`);
}

export function attachTerminal(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  server.on("upgrade", (req, socket, head) => {
    let pathname: string;
    let ticketStr: string | null;
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      pathname = url.pathname;
      ticketStr = url.searchParams.get("ticket");
    } catch {
      socket.destroy();
      return;
    }

    const match = TERMINAL_PATH.exec(pathname);
    if (!match) {
      // We are the only upgrade consumer; anything not addressed to a terminal
      // is dropped.
      socket.destroy();
      return;
    }

    const workspaceId = Number(match[1]);
    if (!ticketStr) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    const ticket = consumeTerminalTicket(ticketStr);
    if (!ticket || ticket.workspaceId !== workspaceId) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    // Enforce the concurrency cap before completing the handshake so we can
    // return a proper HTTP 429.
    if ((sessionsByWallet.get(ticket.wallet) ?? 0) >= MAX_SESSIONS_PER_WALLET) {
      rejectUpgrade(socket, 429, "Too Many Sessions");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // handleUpgrade invokes this callback synchronously, so reserving the slot
      // here is still atomic w.r.t. other upgrade events but — unlike reserving
      // before handleUpgrade — cannot leak a slot if the handshake aborts.
      // runSession owns the reserved slot and always releases it via cleanup().
      bumpSessions(ticket.wallet, 1);
      void runSession(ws, workspaceId, ticket.wallet);
    });
  });
}

async function runSession(
  ws: WebSocket,
  workspaceId: number,
  wallet: string,
): Promise<void> {
  // The caller already reserved a concurrency slot for this wallet.
  const ssh = new SshClient();
  let stream: import("ssh2").ClientChannel | null = null;
  let target: { host: string; port: number } | null = null;
  let authed = false;
  let closed = false;
  let ready = false; // ssh target resolved; frames can be acted on
  const pending: ClientFrame[] = [];
  let idleTimer: NodeJS.Timeout | null = null;
  let resumeTimer: NodeJS.Timeout | null = null;

  const maxTimer = setTimeout(() => {
    sendNotice(ws, "Session time limit reached (4h). Disconnecting.");
    cleanup();
  }, MAX_SESSION_MS);

  const authTimer = setTimeout(() => {
    if (!authed) {
      sendNotice(ws, "No key received. Closing.");
      cleanup();
    }
  }, AUTH_FRAME_TIMEOUT_MS);

  function resetIdle(): void {
    if (closed) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      sendNotice(ws, "Disconnected after 10 minutes of inactivity.");
      cleanup();
    }, IDLE_TIMEOUT_MS);
  }

  function cleanup(): void {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (resumeTimer) clearInterval(resumeTimer);
    clearTimeout(maxTimer);
    clearTimeout(authTimer);
    pending.length = 0;
    try {
      stream?.end();
    } catch {
      /* ignore */
    }
    try {
      ssh.end();
    } catch {
      /* ignore */
    }
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch {
      /* ignore */
    }
    bumpSessions(wallet, -1);
  }

  function handleFrame(frame: ClientFrame): void {
    if (closed) return;
    if (frame.type === "auth") {
      if (authed || !target) return;
      if (typeof frame.privateKey !== "string" || frame.privateKey.length === 0) {
        sendNotice(ws, "Invalid key payload.");
        cleanup();
        return;
      }
      const passphrase =
        typeof frame.passphrase === "string" ? frame.passphrase : undefined;
      authed = true;
      clearTimeout(authTimer);
      const cols = clampDimension(frame.cols, 80);
      const rows = clampDimension(frame.rows, 24);
      connectSsh(frame.privateKey, passphrase, cols, rows);
      // Drop the in-frame copies of the secret as soon as they're handed off.
      frame.privateKey = "";
      frame.passphrase = "";
      return;
    }
    if (!authed || !stream) return;
    if (frame.type === "data") {
      if (typeof frame.data !== "string") return;
      resetIdle();
      stream.write(frame.data);
    } else if (frame.type === "resize") {
      stream.setWindow(
        clampDimension(frame.rows, 24),
        clampDimension(frame.cols, 80),
        0,
        0,
      );
    }
  }

  // Attach socket listeners SYNCHRONOUSLY — before any await — so the client's
  // auth frame (sent immediately on open) is never dropped. Frames that arrive
  // before the ssh target resolves are buffered and drained once ready.
  ws.on("message", (raw, isBinary) => {
    if (closed) return;
    if (isBinary) return; // control protocol is text JSON only
    const frame = parseFrame(raw.toString());
    if (!frame) return;
    if (!ready) {
      if (pending.length < MAX_PENDING_FRAMES) pending.push(frame);
      return;
    }
    handleFrame(frame);
  });
  ws.on("close", cleanup);
  ws.on("error", cleanup);

  function connectSsh(
    privateKey: string,
    passphrase: string | undefined,
    cols: number,
    rows: number,
  ): void {
    if (!target) {
      cleanup();
      return;
    }
    const dest = target;

    ssh.on("ready", () => {
      if (closed) {
        ssh.end();
        return;
      }
      resetIdle();
      ssh.shell({ term: "xterm-256color", cols, rows }, (err, ch) => {
        if (err || closed) {
          sendNotice(ws, "Failed to open a shell on the instance.");
          cleanup();
          return;
        }
        stream = ch;

        ch.on("data", (chunk: Buffer) => {
          if (closed || ws.readyState !== WebSocket.OPEN) return;
          resetIdle();
          ws.send(chunk);
          if (ws.bufferedAmount > BACKPRESSURE_HIGH) {
            ch.pause();
            if (!resumeTimer) {
              resumeTimer = setInterval(() => {
                if (closed) return;
                if (ws.bufferedAmount < BACKPRESSURE_LOW) {
                  ch.resume();
                  if (resumeTimer) {
                    clearInterval(resumeTimer);
                    resumeTimer = null;
                  }
                }
              }, 50);
            }
          }
        });

        ch.stderr.on("data", (chunk: Buffer) => {
          if (!closed && ws.readyState === WebSocket.OPEN) ws.send(chunk);
        });

        ch.on("close", () => {
          sendNotice(ws, "Shell session closed.");
          cleanup();
        });
      });
    });

    ssh.on("error", (err) => {
      // ssh2 error messages are safe to surface (host/auth failures); they never
      // contain the private key.
      sendNotice(ws, `SSH error: ${err.message}`);
      cleanup();
    });

    try {
      // No hostVerifier is set: Vast.ai hosts are ephemeral third-party machines
      // with no stable, attestable host key, so pinning isn't feasible here. The
      // user's key transits an already-TLS-terminated path to this server and
      // then this server -> Vast; this is the same trust boundary as a normal
      // `ssh root@<vast-host>` from the user's laptop.
      ssh.connect({
        host: dest.host,
        port: dest.port,
        username: "root",
        privateKey,
        passphrase: passphrase || undefined,
        readyTimeout: 20_000,
        keepaliveInterval: 30_000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "connection failed";
      sendNotice(ws, `Could not start SSH connection: ${message}`);
      cleanup();
    }
  }

  // Resolve the SSH target server-side from the workspace's provider instance.
  try {
    const [rental] = await db
      .select()
      .from(rentalsTable)
      .where(eq(rentalsTable.id, workspaceId))
      .limit(1);

    if (
      !rental ||
      rental.paymentStatus !== "paid" ||
      !walletIdentitiesMatch(rental.payerWallet, wallet) ||
      !rental.vastInstanceId
    ) {
      sendNotice(ws, "This workspace is not available for terminal access.");
      cleanup();
      return;
    }

    const instances = await getInstances();
    const inst = instances.find((i) => i.id === rental.vastInstanceId);
    if (!inst || !inst.sshHost || inst.sshPort == null) {
      sendNotice(
        ws,
        "Connection details are not available yet. Wait for the instance to finish provisioning, then try again.",
      );
      cleanup();
      return;
    }
    const port = Number(inst.sshPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      sendNotice(ws, "The instance reported an invalid SSH port.");
      cleanup();
      return;
    }
    target = { host: inst.sshHost, port };
  } catch (err) {
    logger.warn({ err, workspaceId }, "terminal: failed to resolve SSH target for workspace");
    sendNotice(ws, "Could not resolve the instance connection details.");
    cleanup();
    return;
  }

  if (closed) return;

  sendNotice(ws, "Paste your private key to connect. It stays in memory only.");

  // Target resolved — start acting on frames and drain anything buffered while
  // we were resolving (the auth frame almost always arrives during that window).
  ready = true;
  while (pending.length > 0 && !closed) {
    const frame = pending.shift();
    if (frame) handleFrame(frame);
  }
}
