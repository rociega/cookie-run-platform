// Developer API keys: generation, hashing, and the programmatic-access
// middleware. Keys are high-entropy random secrets identified by their SHA-256
// hash (indexed unique column), so authentication is a single exact-match lookup
// — no per-row comparison and no timing-attack surface over a 256-bit space.
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  apiKeysTable,
  rewardAccountsTable,
} from "@workspace/db";
import { API_KEY_RATE_LIMIT_PER_MIN } from "./config";
import { requireAuth } from "./walletAuth";

export const API_KEY_PREFIX = "icpx_sk_";

export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

// 32 random bytes (256 bits) of entropy. The plaintext is returned to the caller
// exactly once; we persist only its hash plus a non-secret display prefix/last4.
export function generateApiKey(): {
  plaintext: string;
  keyHash: string;
  displayPrefix: string;
  last4: string;
} {
  const secret = crypto.randomBytes(32).toString("base64url");
  const plaintext = `${API_KEY_PREFIX}${secret}`;
  return {
    plaintext,
    keyHash: hashApiKey(plaintext),
    displayPrefix: plaintext.slice(0, API_KEY_PREFIX.length + 6),
    last4: plaintext.slice(-4),
  };
}

// Accept the key from `Authorization: Bearer icpx_sk_...` or `x-api-key`. The
// prefix gate means a wallet session bearer is never mistaken for an API key.
function extractApiKey(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    if (token.startsWith(API_KEY_PREFIX)) return token;
  }
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.startsWith(API_KEY_PREFIX)) return x;
  return null;
}

// Throttle lastUsedAt writes so a busy key doesn't write on every request.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
const lastUsedWrites = new Map<number, number>();

function touchLastUsed(keyId: number): void {
  const now = Date.now();
  if (now - (lastUsedWrites.get(keyId) ?? 0) < LAST_USED_THROTTLE_MS) return;
  lastUsedWrites.set(keyId, now);
  void db
    .update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, keyId))
    .catch(() => lastUsedWrites.delete(keyId));
}

// Best-effort in-process fixed-window rate limiter, keyed by API key id. Correct
// for a single instance; under horizontal scale each instance keeps its own
// window so the effective limit multiplies — acceptable until abuse/billing
// makes a shared store worth the cost.
const RATE_WINDOW_MS = 60 * 1000;
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<number, Bucket>();

function checkRateLimit(keyId: number): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
} {
  const limit = API_KEY_RATE_LIMIT_PER_MIN;
  const now = Date.now();
  let bucket = buckets.get(keyId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    buckets.set(keyId, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

// Express middleware: authenticate a programmatic caller by API key, enforce the
// per-key rate limit, and stash the owning reward account on res.locals.account
// (same shape requireAuth uses, so key-auth and session-auth handlers are
// interchangeable).
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const presented = extractApiKey(req);
  if (!presented) {
    res.status(401).json({ error: "Provide a valid API key" });
    return;
  }
  const keyHash = hashApiKey(presented);
  const [key] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.keyHash, keyHash), eq(apiKeysTable.revoked, false)))
    .limit(1);
  if (!key) {
    res.status(401).json({ error: "Invalid or revoked API key" });
    return;
  }

  const rl = checkRateLimit(key.id);
  res.setHeader("X-RateLimit-Limit", String(rl.limit));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
  if (!rl.allowed) {
    res.setHeader(
      "Retry-After",
      String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
    );
    res.status(429).json({ error: "Rate limit exceeded — slow down" });
    return;
  }

  const [account] = await db
    .select()
    .from(rewardAccountsTable)
    .where(eq(rewardAccountsTable.id, key.accountId))
    .limit(1);
  if (!account) {
    res.status(401).json({ error: "Account not found" });
    return;
  }

  res.locals.account = account;
  res.locals.apiKey = key;
  touchLastUsed(key.id);
  next();
}

// Accept EITHER a wallet session OR an API key. If an API-key-shaped credential
// is presented we use key auth (with rate limiting); otherwise we fall back to
// the wallet session path. Lets the same endpoint serve the dashboard and
// programmatic clients.
export function requireAnyAccountAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void | Promise<void> {
  if (extractApiKey(req)) return apiKeyAuth(req, res, next);
  return requireAuth(req, res, next);
}
