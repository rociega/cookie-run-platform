// Solana-compatible payment helpers: COOK pricing and on-chain verification.
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  COOKIE_CHAIN_RPC_URL,
  COOKIE_COOK_PRICE_MINT,
  SOLANA_RPC_URL,
} from "./config";

export const LAMPORTS_PER_SOL = 1_000_000_000n;

let _conn: Connection | null = null;
function conn(): Connection {
  if (!_conn) _conn = new Connection(COOKIE_CHAIN_RPC_URL, "confirmed");
  return _conn;
}

let _solanaConn: Connection | null = null;
function solanaConn(): Connection {
  if (!_solanaConn) _solanaConn = new Connection(SOLANA_RPC_URL, "confirmed");
  return _solanaConn;
}

// Legacy SOL/USD price helper retained for historical records.
export async function getSolUsd(): Promise<number> {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot");
    if (r.ok) {
      const d = (await r.json()) as { data?: { amount?: string } };
      const p = Number(d?.data?.amount);
      if (p > 0) return p;
    }
  } catch {
    // fall through to backup source
  }

  const r2 = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
  );
  if (r2.ok) {
    const d = (await r2.json()) as { solana?: { usd?: number } };
    const p = Number(d?.solana?.usd);
    if (p > 0) return p;
  }

  throw new Error("Unable to fetch legacy SOL/USD price");
}

// Live COOK/USD price for Cookie Chain native checkout. The market reference
// is configured explicitly because there are unrelated tokens named COOK.
// The payment itself remains a native SystemProgram transfer.
export async function getCookUsd(): Promise<number> {
  // COOK is Cookie Chain's native asset, so it has no native mint to use as
  // an identity. CookieScan exposes the native COOK/USD reference directly.
  try {
    const native = await fetch("https://api.cookiescan.io/api/tokens/search?q=cook");
    if (native.ok) {
      const data = (await native.json()) as { cookUsd?: number };
      const nativePrice = Number(data.cookUsd);
      if (nativePrice > 0) return nativePrice;
    }
  } catch {
    // fall through to the explicitly configured market reference
  }
  if (!COOKIE_COOK_PRICE_MINT) {
    throw new Error("Unable to fetch native COOK/USD price");
  }
  try {
    const r = await fetch(
      `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(COOKIE_COOK_PRICE_MINT)}`,
    );
    if (r.ok) {
      const d = (await r.json()) as Record<string, { usdPrice?: number } | undefined>;
      const p = Number(d?.[COOKIE_COOK_PRICE_MINT]?.usdPrice);
      if (p > 0) return p;
    }
  } catch {
    // fall through to backup source
  }
  const r2 = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(COOKIE_COOK_PRICE_MINT)}`,
  );
  if (r2.ok) {
    const d = (await r2.json()) as {
      pairs?: Array<{ priceUsd?: string; liquidity?: { usd?: number } }>;
    };
    let best = 0;
    let bestLiquidity = -1;
    for (const pair of d?.pairs ?? []) {
      const price = Number(pair.priceUsd);
      const liquidity = Number(pair.liquidity?.usd ?? 0);
      if (price > 0 && liquidity > bestLiquidity) {
        best = price;
        bestLiquidity = liquidity;
      }
    }
    if (best > 0) return best;
  }
  throw new Error("Unable to fetch COOK/USD price");
}

// Live $ICPX/USD price. Jupiter's lite price API is primary; DexScreener (most
// liquid pair) is the fallback. Both are unauthenticated. Throws if neither
// returns a positive price so we never quote against a zero/garbage value.
export async function getIcpxUsd(mint: string): Promise<number> {
  try {
    const r = await fetch(
      `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(mint)}`,
    );
    if (r.ok) {
      const d = (await r.json()) as Record<string, { usdPrice?: number } | undefined>;
      const p = Number(d?.[mint]?.usdPrice);
      if (p > 0) return p;
    }
  } catch {
    // fall through to backup source
  }

  const r2 = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`,
  );
  if (r2.ok) {
    const d = (await r2.json()) as {
      pairs?: Array<{ priceUsd?: string; liquidity?: { usd?: number } }>;
    };
    let best = 0;
    let bestLiquidity = -1;
    for (const pair of d?.pairs ?? []) {
      const price = Number(pair.priceUsd);
      const liquidity = Number(pair.liquidity?.usd ?? 0);
      if (price > 0 && liquidity > bestLiquidity) {
        best = price;
        bestLiquidity = liquidity;
      }
    }
    if (best > 0) return best;
  }

  throw new Error("Unable to fetch ICPX/USD price");
}

// Canonical associated token account (ATA) for an spl-token-2022 mint + owner.
// Used both to tell the buyer where to send $ICPX and to verify the destination
// server-side — the stored value is never trusted for verification.
export function deriveTokenAccount(owner: string, mint: string): string {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(owner),
    true, // allowOwnerOffCurve — operator wallet may be a PDA/off-curve key
    TOKEN_2022_PROGRAM_ID,
  ).toBase58();
}

// Format raw base units (string/bigint) as a human display amount using integer
// math so we never lose precision for large token quantities.
export function formatTokenAmount(
  raw: bigint | string,
  decimals: number,
): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

export interface PaymentVerification {
  ok: boolean;
  reason?: string;
  lamportsReceived?: bigint;
  // The on-chain fee payer (accountKeys[0]) — the wallet that actually paid. We
  // derive and persist this so the owning wallet can list its rental later. It
  // is read FROM the chain, never trusted client input, so it is never enforced
  // against a pre-supplied address.
  payer?: string;
}

export interface VerifyPaymentOptions {
  // Unique per-order reference that must appear in the transaction's memo. This
  // binds a payment to one specific order so a signature cannot be replayed to
  // settle a different order.
  reference?: string;
  // When present, the transaction fee payer must match this wallet. New
  // Cookie orders always provide this; null remains valid for legacy rows.
  expectedPayer?: string | null;
}

// SPL Memo program IDs (v2 and the legacy v1).
const MEMO_PROGRAM_IDS = new Set([
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

// Verify that `signature` is a confirmed transaction transferring at least
// `expectedLamports` to `destination`. When `opts.reference` is given, the
// transaction must also carry that reference in a memo. On success the result
// includes the on-chain fee payer (`payer`) so the caller can bind the order to
// the wallet that actually paid.
export async function verifyPayment(
  signature: string,
  destination: string,
  expectedLamports: bigint,
  opts: VerifyPaymentOptions = {},
  rpcUrl = COOKIE_CHAIN_RPC_URL,
): Promise<PaymentVerification> {
  let destKey: PublicKey;
  try {
    destKey = new PublicKey(destination);
  } catch {
    return { ok: false, reason: "Invalid destination address" };
  }

  let tx;
  try {
    const connection = rpcUrl === SOLANA_RPC_URL ? solanaConn() : conn();
    tx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Could not look up transaction: ${(err as Error).message}`,
    };
  }

  if (!tx) {
    return { ok: false, reason: "Transaction not found or not yet confirmed" };
  }
  if (tx.meta?.err) {
    return { ok: false, reason: "Transaction failed on-chain" };
  }

  const accountKeys = tx.transaction.message.accountKeys;
  const idx = accountKeys.findIndex((k) => k.pubkey.equals(destKey));
  if (idx === -1) {
    return { ok: false, reason: "Payment was not sent to the configured payment wallet" };
  }

  const pre = BigInt(tx.meta?.preBalances?.[idx] ?? 0);
  const post = BigInt(tx.meta?.postBalances?.[idx] ?? 0);
  const received = post - pre;

  if (received < expectedLamports) {
    return {
      ok: false,
      reason: "Insufficient payment amount received",
      lamportsReceived: received,
    };
  }

  // Bind the payment to this specific order via the on-chain memo reference.
  if (opts.reference) {
    const candidates: string[] = [];
    for (const ix of tx.transaction.message.instructions) {
      if ("parsed" in ix && ix.program === "spl-memo") {
        candidates.push(
          typeof ix.parsed === "string" ? ix.parsed : JSON.stringify(ix.parsed),
        );
      } else if ("data" in ix && MEMO_PROGRAM_IDS.has(ix.programId.toString())) {
        candidates.push(ix.data ?? "");
      }
    }
    for (const log of tx.meta?.logMessages ?? []) candidates.push(log);
    const matched = candidates.some((c) => c.includes(opts.reference as string));
    if (!matched) {
      return { ok: false, reason: "Payment is missing the order reference" };
    }
  }

  const payer = accountKeys[0]?.pubkey;
  if (opts.expectedPayer) {
    let expectedPayer: PublicKey;
    try {
      expectedPayer = new PublicKey(opts.expectedPayer);
    } catch {
      return { ok: false, reason: "Invalid expected payer address" };
    }
    if (!payer || !payer.equals(expectedPayer)) {
      return { ok: false, reason: "Payment payer did not match the order wallet" };
    }
  }

  return {
    ok: true,
    lamportsReceived: received,
    // Fee payer = the wallet that signed/paid. Derived from the chain (not from
    // any client-supplied address) so it's safe to persist as the rental owner.
    payer: payer?.toBase58(),
  };
}

export async function verifySolPayment(
  signature: string,
  destination: string,
  expectedLamports: bigint,
  opts: VerifyPaymentOptions = {},
): Promise<PaymentVerification> {
  return verifyPayment(signature, destination, expectedLamports, opts, SOLANA_RPC_URL);
}

// Re-derive the on-chain fee payer (the funding wallet) for a known-good payment
// signature. Used to attribute legacy paid rentals that were stored before we
// persisted the payer. Returns null if the tx can't be resolved or failed — the
// caller treats that as "not adoptable right now" and tries again later.
export async function getTransactionFeePayer(
  signature: string,
): Promise<string | null> {
  let tx;
  try {
    tx = await conn().getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    return null;
  }
  if (!tx || tx.meta?.err) return null;
  return tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? null;
}

export interface TokenPaymentVerification {
  ok: boolean;
  reason?: string;
  amountReceived?: bigint;
  payer?: string;
}

export interface VerifyTokenPaymentOptions extends VerifyPaymentOptions {
  // Bound the quote freshness by the payment's ON-CHAIN time (blockTime), not the
  // confirm time, so an honest buyer who paid in time is never rejected for
  // confirming late. Both must be set (and blockTime present) to enforce.
  quoteCreatedAtMs?: number;
  maxQuoteAgeMs?: number;
}

// Verify that `signature` is a confirmed spl-token-2022 transfer delivering at
// least `expectedRawAmount` base units of `mint` into `destinationAta`, an ATA
// owned by `ownerWallet`. The destination/owner/mint are all bound so a transfer
// of a different token, or to a different account, cannot settle the order. When
// `opts.reference` is given the transfer must also carry that memo. Returns the
// on-chain fee payer so the caller can attribute the rental.
export async function verifyTokenPayment(
  signature: string,
  destinationAta: string,
  mint: string,
  ownerWallet: string,
  expectedRawAmount: bigint,
  opts: VerifyTokenPaymentOptions = {},
): Promise<TokenPaymentVerification> {
  if (expectedRawAmount <= 0n) {
    return { ok: false, reason: "Invalid expected token amount" };
  }
  let ataKey: PublicKey;
  try {
    ataKey = new PublicKey(destinationAta);
  } catch {
    return { ok: false, reason: "Invalid destination token account" };
  }

  let tx;
  try {
    tx = await conn().getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Could not look up transaction: ${(err as Error).message}`,
    };
  }

  if (!tx) {
    return { ok: false, reason: "Transaction not found or not yet confirmed" };
  }
  if (tx.meta?.err) {
    return { ok: false, reason: "Transaction failed on-chain" };
  }

  const accountKeys = tx.transaction.message.accountKeys;
  const idx = accountKeys.findIndex((k) => k.pubkey.equals(ataKey));
  if (idx === -1) {
    return { ok: false, reason: "Payment was not sent to the ICPX token account" };
  }

  // Match the destination ATA's token-balance entries by account index, then
  // assert mint + owner so only a real $ICPX transfer to the operator counts.
  const post = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === idx);
  if (!post) {
    return { ok: false, reason: "No token balance change for the ICPX wallet" };
  }
  if (post.mint !== mint || post.owner !== ownerWallet) {
    return { ok: false, reason: "Payment token or recipient did not match" };
  }
  const pre = tx.meta?.preTokenBalances?.find((b) => b.accountIndex === idx);
  const preAmount = BigInt(pre?.uiTokenAmount.amount ?? "0");
  const postAmount = BigInt(post.uiTokenAmount.amount);
  const received = postAmount - preAmount;
  if (received < expectedRawAmount) {
    return {
      ok: false,
      reason: "Insufficient ICPX payment amount received",
      amountReceived: received,
    };
  }

  // Bind the payment to this specific order via the on-chain memo reference.
  if (opts.reference) {
    const candidates: string[] = [];
    for (const ix of tx.transaction.message.instructions) {
      if ("parsed" in ix && ix.program === "spl-memo") {
        candidates.push(
          typeof ix.parsed === "string" ? ix.parsed : JSON.stringify(ix.parsed),
        );
      } else if ("data" in ix && MEMO_PROGRAM_IDS.has(ix.programId.toString())) {
        candidates.push(ix.data ?? "");
      }
    }
    for (const log of tx.meta?.logMessages ?? []) candidates.push(log);
    const matched = candidates.some((c) => c.includes(opts.reference as string));
    if (!matched) {
      return { ok: false, reason: "Payment is missing the order reference" };
    }
  }

  // Quote freshness: reject only when the payment itself landed after the quote
  // window. blockTime is seconds since epoch; if it's missing we cannot judge, so
  // we accept rather than risk stranding a real payment.
  if (
    opts.quoteCreatedAtMs != null &&
    opts.maxQuoteAgeMs != null &&
    typeof tx.blockTime === "number"
  ) {
    const paidAtMs = tx.blockTime * 1000;
    if (paidAtMs - opts.quoteCreatedAtMs > opts.maxQuoteAgeMs) {
      return {
        ok: false,
        reason: "This ICPX quote expired before the payment was made",
      };
    }
  }

  return {
    ok: true,
    amountReceived: received,
    payer: accountKeys[0]?.pubkey.toBase58(),
  };
}
