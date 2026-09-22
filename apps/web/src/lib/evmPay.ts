import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { Buffer } from "buffer";

export interface EvmPaymentQuote {
  currency: string;
  destination: string;
  lamports?: string;
  amountBaseUnits?: string;
  paymentReference: string;
  quoteExpiresAt?: string | null;
  assetDecimals?: number | null;
}

function exactAmount(value: string | undefined): bigint {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("The payment quote has an invalid amount.");
  }
  return BigInt(value);
}

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export function buildEvmTransaction(address: string, quote: EvmPaymentQuote): Transaction {
  if (quote.currency !== "COOK" && quote.currency !== "SOL") {
    throw new Error("This order is not a supported native payment.");
  }
  if (quote.quoteExpiresAt && Date.parse(quote.quoteExpiresAt) <= Date.now()) {
    throw new Error("This payment quote has expired. Request a new quote.");
  }
  const payer = new PublicKey(address);
  const destination = new PublicKey(quote.destination);
  const lamports = exactAmount(quote.lamports ?? quote.amountBaseUnits);
  return new Transaction({ feePayer: payer })
    .add(
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: destination, lamports }),
    )
    .add(
      new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(quote.paymentReference, "utf8"),
      }),
    );
}

export async function checkEvmFunds(
  provider: Connection,
  transaction: Transaction,
  quote?: EvmPaymentQuote,
): Promise<string | null> {
  if (!transaction.feePayer) return "The payment transaction is missing its payer.";
  try {
    const balance = BigInt(await provider.getBalance(transaction.feePayer));
    const needed = exactAmount(quote?.lamports ?? quote?.amountBaseUnits);
    if (balance < needed + 10_000n) {
      return `Not enough ${quote?.currency ?? "COOK"} for this payment and the network fee.`;
    }
    return null;
  } catch (error) {
    throw new Error(`Unable to safely estimate the network fee: ${describeEvmPayError(error)}`);
  }
}

export async function waitForEvmConfirmation(
  provider: Connection,
  transactionHash: string,
  timeoutMs = 180_000,
): Promise<void> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(transactionHash)) {
    throw new Error("Wallet returned an invalid transaction signature.");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await provider.getSignatureStatus(transactionHash);
    if (status.value?.err) throw new Error("The transaction failed on-chain.");
    if (
      status.value?.confirmationStatus === "confirmed" ||
      status.value?.confirmationStatus === "finalized"
    ) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error("Transaction is still pending. Keep this page open and retry confirmation shortly.");
}

export function formatEthDisplay(amount: string | undefined): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toFixed(n < 0.001 ? 8 : n < 1 ? 6 : 4);
}

export function formatTokenDisplay(amount: string | undefined, decimals: number | null | undefined): string {
  if (!amount || decimals == null || !Number.isInteger(decimals) || decimals < 0) return "—";
  const raw = BigInt(amount);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = (raw % divisor).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
}

export function describeEvmPayError(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : error instanceof Error
        ? error.message
        : "Payment failed.";
  if (/user rejected|denied|cancelled|canceled|reject/i.test(message)) {
    return "Wallet request was cancelled.";
  }
  return message;
}