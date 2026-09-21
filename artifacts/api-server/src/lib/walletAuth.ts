// Sign-in-with-wallet for the off-chain ICPX rewards system.
//
// Stateless by design — no nonce/session rows. A challenge is an HMAC-signed
// payload (wallet + issuedAt + nonce); the client signs the *reconstructed*
// message and we verify the ed25519 signature against the wallet's pubkey. A
// session is a separate HMAC-signed {wallet, exp} bearer token. Both are signed
// with SESSION_SECRET. We never trust a client-supplied message string — it is
// always rebuilt server-side from the HMAC-validated challenge payload.
import crypto from "node:crypto";
import { verifyMessage } from "ethers";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import type { Request, Response, NextFunction } from "express";
import { eq, sql, type AnyColumn } from "drizzle-orm";
import { db, rewardAccountsTable, type RewardAccount } from "@workspace/db";
import { SESSION_SECRET } from "./config";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ROBINHOOD_CHAIN_ID = 4663;

function sign(data: string): string {
  if (!SESSION_SECRET) {
    // Never HMAC with an empty key — an attacker could reproduce it and forge
    // both challenges and session tokens. Routes guard with isRewardsConfigured
    // and 503 before reaching here; this is the defensive backstop.
    throw new Error("SESSION_SECRET is not configured");
  }
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

interface ChallengePayload {
  w: string;
  t: number;
  n: string;
  // Fields are deliberately absent from legacy Solana challenges. This keeps
  // their signed message byte-for-byte compatible with existing clients.
  k?: "evm";
  d?: string;
  c?: number;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isEthereumAddress(wallet: string): boolean {
  return EVM_ADDRESS.test(wallet);
}

// A Solana base58 public key can never contain "0", so a valid 0x address and
// a Solana wallet identity cannot overlap. EVM identities are always stored
// lower-case, rather than relying on a checksum/casing convention in the DB.
export function normalizeWalletAddress(wallet: string): string | null {
  if (wallet.startsWith("0x") || wallet.startsWith("0X")) {
    return EVM_ADDRESS.test(wallet) ? wallet.toLowerCase() : null;
  }

  try {
    new PublicKey(wallet);
    return wallet;
  } catch {
    return null;
  }
}

/**
 * Wallet identities are case-sensitive for Solana base58 addresses, but EVM
 * addresses are hexadecimal and therefore case-insensitive.  EVM addresses
 * written by an RPC provider are commonly checksum-cased while signed-in
 * identities are stored lower-case, so ownership checks must not use a plain
 * string comparison for EVM rows.
 */
export function walletIdentitiesMatch(
  storedWallet: string | null | undefined,
  presentedWallet: string | null | undefined,
): boolean {
  if (!storedWallet || !presentedWallet) return false;
  if (EVM_ADDRESS.test(storedWallet) && EVM_ADDRESS.test(presentedWallet)) {
    return storedWallet.toLowerCase() === presentedWallet.toLowerCase();
  }
  return storedWallet === presentedWallet;
}

/**
 * Build an ownership predicate that keeps legacy mixed-case EVM rows visible
 * without weakening Solana's case-sensitive identity semantics.
 */
export function walletColumnEquals(column: AnyColumn, wallet: string) {
  return EVM_ADDRESS.test(wallet)
    ? sql`lower(${column}) = ${wallet.toLowerCase()}`
    : eq(column, wallet);
}

/**
 * Normalize only EVM values before persisting them. Invalid values are kept
 * unchanged so a malformed payer cannot silently turn into an unbound payment
 * quote; Solana addresses retain their original base58 casing.
 */
export function normalizeWalletForStorage(
  wallet: string | null | undefined,
): string | null {
  if (!wallet) return null;
  return EVM_ADDRESS.test(wallet) ? wallet.toLowerCase() : wallet;
}

function normalizeDomain(domain: string | undefined): string | null {
  if (!domain) return null;
  const normalized = domain.toLowerCase();
  // Domain values are displayed in the signed message, so disallow whitespace,
  // control characters, and any URL path/query component.
  if (
    normalized.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|[0-9a-f:.]+)$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

// The exact human-readable text the wallet signs. Reconstructed identically on
// verify so the signature is bound to wallet + nonce + issue time.
function challengeMessage(p: ChallengePayload): string {
  if (p.k === "evm") {
    return [
      "COOKIE RUN — WALLET SIGN-IN",
      "",
      `Domain: ${p.d}`,
      `Chain ID: ${p.c}`,
      `Wallet: ${p.w}`,
      `Nonce: ${p.n}`,
      `Issued: ${new Date(p.t).toISOString()}`,
      `Expires: ${new Date(p.t + CHALLENGE_TTL_MS).toISOString()}`,
      "Purpose: Sign in to Cookie Run rewards.",
      "",
      "Sign this message to verify you own this wallet and unlock Cookie Run rewards.",
      "It is free, off-chain, and will NOT move any funds or tokens.",
    ].join("\n");
  }

  return [
    "COOKIE RUN — WALLET SIGN-IN",
    "",
    `Wallet: ${p.w}`,
    `Nonce: ${p.n}`,
    `Issued: ${new Date(p.t).toISOString()}`,
    "",
    "Sign this message to verify you own this wallet and unlock Cookie Run rewards.",
    "It is free, off-chain, and will NOT move any funds or tokens.",
  ].join("\n");
}

export function createChallenge(
  wallet: string,
  domain?: string,
): { message: string; challengeToken: string } {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet) throw new Error("Invalid wallet address");

  const payload: ChallengePayload = {
    w: normalizedWallet,
    t: Date.now(),
    n: crypto.randomBytes(8).toString("hex"),
  };
  if (isEthereumAddress(normalizedWallet)) {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) throw new Error("Invalid sign-in domain");
    payload.k = "evm";
    payload.d = normalizedDomain;
    payload.c = ROBINHOOD_CHAIN_ID;
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const challengeToken = `${body}.${sign(body)}`;
  return { message: challengeMessage(payload), challengeToken };
}

export function verifySignedChallenge(args: {
  wallet: string;
  challengeToken: string;
  signature: string;
  expectedDomain?: string;
}): { ok: boolean; reason?: string } {
  const { wallet, challengeToken, signature, expectedDomain } = args;

  const dot = challengeToken.indexOf(".");
  if (dot < 0) return { ok: false, reason: "Malformed challenge" };
  const body = challengeToken.slice(0, dot);
  const sig = challengeToken.slice(dot + 1);
  if (!safeEqual(sign(body), sig)) return { ok: false, reason: "Invalid challenge" };

  let payload: ChallengePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return { ok: false, reason: "Invalid challenge" };
  }
  if (
    typeof payload.w !== "string" ||
    typeof payload.t !== "number" ||
    !Number.isFinite(payload.t) ||
    typeof payload.n !== "string"
  ) {
    return { ok: false, reason: "Invalid challenge" };
  }
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet) return { ok: false, reason: "Invalid wallet address" };
  if (payload.w !== normalizedWallet) return { ok: false, reason: "Wallet mismatch" };

  const age = Date.now() - payload.t;
  if (age < 0 || age > CHALLENGE_TTL_MS) {
    return { ok: false, reason: "Challenge expired — try again" };
  }

  const message = challengeMessage(payload);

  if (payload.k === "evm") {
    if (
      !isEthereumAddress(payload.w) ||
      payload.c !== ROBINHOOD_CHAIN_ID ||
      typeof payload.d !== "string" ||
      !normalizeDomain(payload.d)
    ) {
      return { ok: false, reason: "Invalid challenge" };
    }
    const normalizedExpectedDomain = normalizeDomain(expectedDomain);
    if (expectedDomain !== undefined && normalizedExpectedDomain !== payload.d) {
      return { ok: false, reason: "Challenge domain mismatch" };
    }
    // Standard personal_sign signatures are hex-encoded 64-byte compact or
    // 65-byte recoverable signatures. Solana's legacy base64 path stays below.
    if (!/^0x[0-9a-fA-F]{128}(?:[0-9a-fA-F]{2})?$/.test(signature)) {
      return { ok: false, reason: "Invalid signature encoding" };
    }
    try {
      const recovered = verifyMessage(message, signature).toLowerCase();
      return recovered === payload.w
        ? { ok: true }
        : { ok: false, reason: "Signature verification failed" };
    } catch {
      return { ok: false, reason: "Signature verification failed" };
    }
  }

  // A challenge without the EVM discriminator remains the legacy Solana
  // protocol, including its original message and base64 ed25519 signature.
  if (payload.k !== undefined || !normalizeWalletAddress(payload.w) || isEthereumAddress(payload.w)) {
    return { ok: false, reason: "Invalid challenge" };
  }
  const messageBytes = new TextEncoder().encode(message);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = new Uint8Array(Buffer.from(signature, "base64"));
  } catch {
    return { ok: false, reason: "Invalid signature encoding" };
  }
  if (signatureBytes.length !== 64) return { ok: false, reason: "Invalid signature" };

  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = new PublicKey(normalizedWallet).toBytes();
  } catch {
    return { ok: false, reason: "Invalid wallet address" };
  }

  const ok = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
  return ok ? { ok: true } : { ok: false, reason: "Signature verification failed" };
}

export function issueSession(wallet: string): string {
  const payload = { w: wallet, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSession(token: string): string | null {
  if (!SESSION_SECRET) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sign(body), sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      w?: string;
      exp?: number;
    };
    if (!payload.w || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload.w;
  } catch {
    return null;
  }
}

// Express middleware: resolves the bearer token to a reward account and stashes
// it on res.locals.account. Responds 401 when unauthenticated.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!SESSION_SECRET) {
    res.status(503).json({ error: "Rewards are not configured" });
    return;
  }
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const wallet = token ? readSession(token) : null;
  if (!wallet) {
    res.status(401).json({ error: "Sign in with your wallet to continue" });
    return;
  }
  const [account] = await db
    .select()
    .from(rewardAccountsTable)
    .where(walletColumnEquals(rewardAccountsTable.walletAddress, wallet))
    .limit(1);
  if (!account) {
    res.status(401).json({ error: "Account not found — sign in again" });
    return;
  }
  res.locals.account = account;
  next();
}

export function currentAccount(res: Response): RewardAccount {
  return res.locals.account as RewardAccount;
}
