// One-time, short-lived tickets that authorize a single WebSocket terminal
// upgrade. The WS upgrade bypasses Express middleware, so we cannot run
// requireAuth there. Instead the authed REST endpoint mints a ticket bound to
// {workspaceId, wallet}; the client passes it as ?ticket=... on the wss URL and the
// upgrade handler consumes it exactly once. Bearer tokens are NEVER put in the
// URL (they'd leak via logs/referrers); a ticket is single-use and expires fast.
import { randomBytes } from "node:crypto";

export interface TerminalTicket {
  workspaceId: number;
  wallet: string;
  exp: number;
}

const TICKET_TTL_MS = 60_000;

const tickets = new Map<string, TerminalTicket>();

function sweepExpired(now: number): void {
  for (const [key, value] of tickets) {
    if (value.exp <= now) tickets.delete(key);
  }
}

export function mintWorkspaceTerminalTicket(
  workspaceId: number,
  wallet: string,
): { ticket: string; expiresInSeconds: number } {
  const now = Date.now();
  sweepExpired(now);
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, { workspaceId, wallet, exp: now + TICKET_TTL_MS });
  return { ticket, expiresInSeconds: Math.floor(TICKET_TTL_MS / 1000) };
}

/** @deprecated Use mintWorkspaceTerminalTicket for the legacy rentals route. */
export const mintTerminalTicket = mintWorkspaceTerminalTicket;

// Single-use: looking up a ticket always removes it, valid or not.
export function consumeTerminalTicket(ticket: string): TerminalTicket | null {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);
  if (entry.exp <= Date.now()) return null;
  return entry;
}
