import {
  type Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { Buffer } from "buffer";

// Conservative SOL buffer (lamports) an ICPX payer needs on hand: ~1 signature
// fee plus rent in case the operator's token account must be created. If it
// already exists the idempotent create is a no-op and only the fee applies.
export const ICPX_SOL_FEE_BUFFER = 2_100_000n;

// SPL Memo program — stamps the order reference onto the payment so the backend
// can bind this transaction to this specific order (prevents signature replay).
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

// The minimal payment shape shared by workspaces and marketplace purchases.
// Both server quotes expose exactly these fields, so the SOL/ICPX transaction
// builders and balance pre-flights below work for either flow.
export interface PayQuote {
  currency: string;
  destination: string;
  lamports: string;
  paymentReference: string;
  tokenMint?: string | null;
  tokenAmount?: string | null;
  expectedTokenAmount?: string | null;
}

// Surface the *real* failure reason instead of swallowing it. Wallet adapters
// wrap the underlying cause (often >200 chars), so walk the cause chain and
// classify the common cases so the payer knows whether they rejected it, are
// short on funds, or hit a transient network issue.
export function describePayError(e: unknown): string {
  let msg = "";
  let code: unknown;
  let cur: unknown = e;
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof o.message === "string" && o.message) msg = o.message;
    if (o.code !== undefined && code === undefined) code = o.code;
    cur = o.cause;
  }
  const low = msg.toLowerCase();
  if (code === 4001 || /reject|declin|denied|cancel|user closed/i.test(msg)) {
    return "You cancelled the transaction in your wallet.";
  }
  if (
    /insufficient|not enough|debit an account|exceeds.*balance|attempt to debit/i.test(
      low,
    )
  ) {
    return "Not enough funds in your wallet to cover this payment plus the network fee.";
  }
  if (/blockhash|block height exceeded|expired/i.test(low)) {
    return "The network was busy and the transaction expired before it landed. Please try again.";
  }
  if (/timed out|timeout/i.test(low)) {
    return "Confirmation timed out — your funds are safe. Retry to finish.";
  }
  if (msg) return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
  return "Something went wrong sending the payment. Please try again.";
}

// Beacon client-side pay errors to the server so production failures (which
// otherwise never leave the browser) are diagnosable. Best-effort and silent.
export function reportPayError(stage: string, e: unknown, wallet?: string) {
  try {
    const o = e as { name?: unknown; message?: unknown };
    void fetch(`${window.location.origin}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        stage,
        name: typeof o?.name === "string" ? o.name : null,
        message:
          typeof o?.message === "string"
            ? o.message.slice(0, 500)
            : String(e).slice(0, 500),
        wallet: wallet ?? null,
      }),
    }).catch(() => {});
  } catch {
    /* never let logging break the pay flow */
  }
}

export function shortKey(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

// Poll for confirmation over HTTP instead of confirmTransaction()'s WebSocket
// signature subscription — the RPC proxy is HTTP-only, so a WS subscription
// would never resolve.
export async function waitForConfirmation(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatus(signature);
    if (value?.err) throw new Error("Transaction failed on-chain");
    if (
      value?.confirmationStatus === "confirmed" ||
      value?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Confirmation timed out — retry to finish.");
}

// The order reference is stamped onto every payment (SOL or ICPX) via the SPL
// Memo program so the backend can bind the transaction to this specific order.
function memoInstruction(reference: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(reference, "utf8"),
  });
}

export function buildSolTransaction(
  payer: PublicKey,
  quote: PayQuote,
): Transaction {
  return new Transaction()
    .add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: new PublicKey(quote.destination),
        lamports: BigInt(quote.lamports),
      }),
    )
    .add(memoInstruction(quote.paymentReference));
}

// $ICPX is an SPL Token-2022 mint. Pay the operator's associated token account
// (created idempotently so the buyer covers rent only if it doesn't exist yet),
// transfer the exact quoted raw amount with createTransferChecked, and stamp the
// order memo. Decimals come from the server's payment-config (authoritative).
export function buildIcpxTransaction(
  payer: PublicKey,
  quote: PayQuote,
  decimals: number | null | undefined,
): Transaction {
  if (!quote.tokenMint || !quote.expectedTokenAmount) {
    throw new Error(
      "This order is missing token details — please get a fresh quote.",
    );
  }
  if (typeof decimals !== "number") {
    throw new Error(
      "Token configuration unavailable — please refresh and try again.",
    );
  }
  const mint = new PublicKey(quote.tokenMint);
  const operator = new PublicKey(quote.destination);
  const buyerAta = getAssociatedTokenAddressSync(
    mint,
    payer,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const operatorAta = getAssociatedTokenAddressSync(
    mint,
    operator,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  return new Transaction()
    .add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        operatorAta,
        operator,
        mint,
        TOKEN_2022_PROGRAM_ID,
      ),
    )
    .add(
      createTransferCheckedInstruction(
        buyerAta,
        mint,
        operatorAta,
        payer,
        BigInt(quote.expectedTokenAmount),
        decimals,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    )
    .add(memoInstruction(quote.paymentReference));
}

// Pre-flight SOL balance. Returns a human message if underfunded, else null.
// Best-effort: a failed lookup returns null so the real send can surface errors.
export async function checkSolFunds(
  connection: Connection,
  payer: PublicKey,
  quote: PayQuote,
): Promise<string | null> {
  const needed = BigInt(quote.lamports) + 5000n; // + ~1 signature fee
  try {
    const bal = BigInt(Math.round(await connection.getBalance(payer)));
    if (bal < needed) {
      const have = (Number(bal) / 1e9).toFixed(4);
      const need = (Number(needed) / 1e9).toFixed(4);
      return `Not enough SOL: this payment needs ~${need} SOL (incl. network fee), but your wallet has ${have} SOL.`;
    }
  } catch {
    /* balance precheck is best-effort */
  }
  return null;
}

// Pre-flight for ICPX payers: enough $ICPX to cover the quote AND a little SOL
// for the network fee (+ rent if the operator's token account is new). Balances
// are read via getAccountInfo (jsonParsed) — the only account methods the RPC
// proxy whitelists. Best-effort throughout.
export async function checkIcpxFunds(
  connection: Connection,
  payer: PublicKey,
  quote: PayQuote,
): Promise<string | null> {
  if (!quote.tokenMint || !quote.expectedTokenAmount) return null;
  const need = BigInt(quote.expectedTokenAmount);
  try {
    const mint = new PublicKey(quote.tokenMint);
    const buyerAta = getAssociatedTokenAddressSync(
      mint,
      payer,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const info = await connection.getParsedAccountInfo(buyerAta);
    let have = 0n;
    let haveDisplay = "0";
    const data = info.value?.data;
    if (
      data &&
      typeof data === "object" &&
      !Buffer.isBuffer(data) &&
      "parsed" in data
    ) {
      const ta = data.parsed?.info?.tokenAmount;
      if (typeof ta?.amount === "string") have = BigInt(ta.amount);
      if (typeof ta?.uiAmountString === "string")
        haveDisplay = ta.uiAmountString;
    }
    if (have < need) {
      return `Not enough $ICPX: this payment costs ${quote.tokenAmount ?? "the quoted amount"} ICPX, but your wallet has ${haveDisplay} ICPX.`;
    }
  } catch {
    /* token balance precheck is best-effort */
  }
  try {
    const sol = BigInt(Math.round(await connection.getBalance(payer)));
    if (sol < ICPX_SOL_FEE_BUFFER) {
      const have = (Number(sol) / 1e9).toFixed(4);
      const need2 = (Number(ICPX_SOL_FEE_BUFFER) / 1e9).toFixed(4);
      return `Not enough SOL for fees: paying with $ICPX still needs ~${need2} SOL on hand for the network fee, but your wallet has ${have} SOL.`;
    }
  } catch {
    /* sol precheck is best-effort */
  }
  return null;
}
