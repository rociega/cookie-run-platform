// Robinhood Chain (EVM) payment quoting and verification. This module is
// deliberately independent from the legacy Solana adapter so historical orders
// remain verifiable without making EVM configuration a hidden dependency.
import {
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  concat,
  formatEther,
  getAddress,
  id,
  isAddress,
  keccak256,
  toBeHex,
  toUtf8Bytes,
} from "ethers";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_PAYMENT_CONFIRMATIONS,
  ROBINHOOD_PAYMENT_WALLET,
  ROBINHOOD_TOKEN_CONTRACT,
  ROBINHOOD_TOKEN_HOOK,
  ROBINHOOD_TOKEN_POOL_ID,
  robinhoodRpcUrl,
} from "./config";

export const EVM_PAYMENT_CHAIN = "robinhood-mainnet";
const EVM_PENDING = "Transaction not found or not yet confirmed";
// Simulation-only multiplier for ETH-denominated prices. Token quotes use
// their own USD-to-token conversion and must not use this multiplier.
export const ETH_SIMULATED_PRICE_MULTIPLIER = 5;

// Flat, disclosed surcharge baked into ETH-denominated quotes to cover
// network/gas costs on the Robinhood Chain rail. Applied only to the ETH
// conversion amount — never to the stored USD price used for seller payouts
// or other payment rails — and always surfaced to the buyer as a labeled
// line item so it is never a hidden charge.
export const ETH_NETWORK_FEE_USD = 1.2;
const V4_POOLS_SLOT = 6;
const v4Hook = new Interface([
  "function poolManager() view returns (address)",
  "function launches(bytes32) view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken, address creator, address buybackCreatorRecipient, address protocolFeeRecipient, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps, bool buybackEnabled)",
]);
const v4Manager = new Interface(["function extsload(bytes32 slot) view returns (bytes32)"]);
const erc20 = new Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
const transferTopic = id("Transfer(address,address,uint256)");

let provider: JsonRpcProvider | null = null;
let providerUrl: string | null = null;

export function isEvmAddress(value: string): boolean {
  return isAddress(value);
}

function rpc(): JsonRpcProvider {
  const url = robinhoodRpcUrl();
  if (!url) throw new Error("Robinhood Chain RPC is not configured for production");
  if (!provider || providerUrl !== url) {
    provider = new JsonRpcProvider(url, ROBINHOOD_CHAIN_ID, { staticNetwork: true });
    providerUrl = url;
  }
  return provider;
}

export async function assertRobinhoodChainReady(): Promise<void> {
  if (!isAddress(ROBINHOOD_PAYMENT_WALLET)) {
    throw new Error("Robinhood payment recipient is not configured with a valid EVM address");
  }
  const network = await rpc().getNetwork();
  if (network.chainId !== BigInt(ROBINHOOD_CHAIN_ID)) {
    throw new Error("Robinhood RPC returned an unexpected chain ID");
  }
}

type DecimalParts = { integer: bigint; scale: number };
function decimalParts(value: string): DecimalParts {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Invalid positive decimal quote");
  const [whole, fraction = ""] = normalized.split(".");
  return { integer: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

// Round up with integer arithmetic: a quote can never undercharge due to a
// binary floating point representation.
export function quoteEthBaseUnits(usd: string, ethUsd: string): bigint {
  const cost = decimalParts(usd);
  const spot = decimalParts(ethUsd);
  if (cost.integer <= 0n || spot.integer <= 0n) throw new Error("Invalid positive price");
  const numerator =
    cost.integer *
    BigInt(ETH_SIMULATED_PRICE_MULTIPLIER) *
    10n ** BigInt(18 + spot.scale);
  const denominator = spot.integer * 10n ** BigInt(cost.scale);
  return (numerator + denominator - 1n) / denominator;
}

export async function getEthUsd(): Promise<string> {
  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
    if (response.ok) {
      const body = (await response.json()) as { data?: { amount?: string } };
      if (body.data?.amount && decimalParts(body.data.amount).integer > 0n) {
        return body.data.amount;
      }
    }
  } catch {
    // Use a second public source; never manufacture a fallback value.
  }
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
  );
  if (response.ok) {
    const body = (await response.json()) as { ethereum?: { usd?: number | string } };
    const value = body.ethereum?.usd;
    if (value !== undefined && decimalParts(String(value)).integer > 0n) return String(value);
  }
  throw new Error("Unable to fetch ETH/USD price");
}

export async function getFrSqrtPriceX96(): Promise<bigint> {
  if (!isAddress(ROBINHOOD_TOKEN_HOOK) || !isAddress(ROBINHOOD_TOKEN_CONTRACT) ||
      !/^0x[0-9a-fA-F]{64}$/.test(ROBINHOOD_TOKEN_POOL_ID)) {
    throw new Error("ForgeRun token pool is not configured");
  }
  await assertRobinhoodChainReady();
  const hookAddress = getAddress(ROBINHOOD_TOKEN_HOOK);
  const [managerResult, launchResult] = await Promise.all([
    rpc().call({ to: hookAddress, data: v4Hook.encodeFunctionData("poolManager") }),
    rpc().call({ to: hookAddress, data: v4Hook.encodeFunctionData("launches", [ROBINHOOD_TOKEN_POOL_ID]) }),
  ]);
  const manager = v4Hook.decodeFunctionResult("poolManager", managerResult)[0] as string;
  const launch = v4Hook.decodeFunctionResult("launches", launchResult);
  if (!launch.registered || getAddress(launch.memecoin) !== getAddress(ROBINHOOD_TOKEN_CONTRACT) ||
      getAddress(launch.quoteToken) !== ZeroAddress || launch.memecoinIsCurrency0) {
    throw new Error("ForgeRun token pool metadata does not match the configured FR/ETH pool");
  }
  const stateSlot = keccak256(concat([ROBINHOOD_TOKEN_POOL_ID, toBeHex(V4_POOLS_SLOT, 32)]));
  const packed = v4Manager.decodeFunctionResult(
    "extsload",
    await rpc().call({ to: manager, data: v4Manager.encodeFunctionData("extsload", [stateSlot]) }),
  )[0] as string;
  const sqrtPriceX96 = BigInt(packed) & ((1n << 160n) - 1n);
  if (sqrtPriceX96 === 0n) throw new Error("ForgeRun token pool has no initialized price");
  return sqrtPriceX96;
}

export function quoteFrBaseUnits(usd: string, ethUsd: string, sqrtPriceX96: bigint): bigint {
  const cost = decimalParts(usd);
  const spot = decimalParts(ethUsd);
  if (cost.integer <= 0n || spot.integer <= 0n || sqrtPriceX96 <= 0n) throw new Error("Invalid live token price");
  const numerator = cost.integer * 10n ** BigInt(spot.scale + 18) * sqrtPriceX96 * sqrtPriceX96;
  const denominator = 10n ** BigInt(cost.scale) * spot.integer * (1n << 192n);
  return (numerator + denominator - 1n) / denominator;
}

export interface EvmPaymentVerification {
  ok: boolean;
  reason?: string;
  payer?: string;
}

export async function verifyRobinhoodNativePayment(args: {
  hash: string;
  destination: string;
  amountBaseUnits: string;
  reference: string;
  quoteExpiresAt: Date | null;
  expectedPayer?: string | null;
}): Promise<EvmPaymentVerification> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.hash)) {
    return { ok: false, reason: "A valid EVM transaction hash is required" };
  }
  if (!isAddress(args.destination)) return { ok: false, reason: "Invalid payment destination" };
  if (args.quoteExpiresAt && Date.now() > args.quoteExpiresAt.getTime()) {
    // Confirmation is still permitted after expiry if the block itself landed in
    // time; do not reject here solely based on confirm time.
  }

  let tx;
  let receipt;
  try {
    await assertRobinhoodChainReady();
    [tx, receipt] = await Promise.all([rpc().getTransaction(args.hash), rpc().getTransactionReceipt(args.hash)]);
  } catch (error) {
    return { ok: false, reason: `Could not look up transaction: ${(error as Error).message}` };
  }
  if (!tx || !receipt || receipt.blockNumber == null) return { ok: false, reason: EVM_PENDING };
  if (receipt.status !== 1) return { ok: false, reason: "Transaction failed on-chain" };
  if (tx.chainId !== BigInt(ROBINHOOD_CHAIN_ID)) return { ok: false, reason: "Payment is on the wrong chain" };
  const latest = await rpc().getBlockNumber();
  if (latest - receipt.blockNumber + 1 < ROBINHOOD_PAYMENT_CONFIRMATIONS) {
    return { ok: false, reason: EVM_PENDING };
  }
  if (!tx.to || getAddress(tx.to) !== getAddress(args.destination)) {
    return { ok: false, reason: "Payment was not sent to the Robinhood payment wallet" };
  }
  let expected: bigint;
  try {
    expected = BigInt(args.amountBaseUnits);
  } catch {
    return { ok: false, reason: "Order has an invalid ETH amount" };
  }
  if (tx.value !== expected) return { ok: false, reason: "Incorrect ETH payment amount" };
  // Robinhood Chain rejects any calldata on a transfer to a plain wallet, so a
  // native ETH payment is always a plain value transfer (no memo). Binding to
  // this order relies on exact amount + destination + payer, together with the
  // system-wide single-use claim on the tx hash performed at confirm time.
  const payer = getAddress(tx.from);
  if (args.expectedPayer) {
    if (!isAddress(args.expectedPayer) || getAddress(args.expectedPayer) !== payer) {
      return { ok: false, reason: "Payment was sent by a different wallet" };
    }
  }
  if (args.quoteExpiresAt) {
    const block = await rpc().getBlock(receipt.blockNumber);
    if (!block) return { ok: false, reason: EVM_PENDING };
    if (block.timestamp * 1000 > args.quoteExpiresAt.getTime()) {
      return { ok: false, reason: "Payment was mined after the quote expired" };
    }
  }
  return { ok: true, payer };
}

export async function verifyRobinhoodTokenPayment(args: {
  hash: string; destination: string; amountBaseUnits: string; reference: string;
  quoteExpiresAt: Date | null; expectedPayer?: string | null; tokenContract: string;
}): Promise<EvmPaymentVerification> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.hash) || !isAddress(args.destination) || !isAddress(args.tokenContract)) {
    return { ok: false, reason: "Token payment details are invalid" };
  }
  let tx; let receipt;
  try {
    await assertRobinhoodChainReady();
    [tx, receipt] = await Promise.all([rpc().getTransaction(args.hash), rpc().getTransactionReceipt(args.hash)]);
  } catch (error) {
    return { ok: false, reason: `Could not look up transaction: ${(error as Error).message}` };
  }
  if (!tx || !receipt || receipt.blockNumber == null) return { ok: false, reason: EVM_PENDING };
  if (receipt.status !== 1 || tx.chainId !== BigInt(ROBINHOOD_CHAIN_ID)) return { ok: false, reason: "Token payment failed or is on the wrong chain" };
  if (await rpc().getBlockNumber() - receipt.blockNumber + 1 < ROBINHOOD_PAYMENT_CONFIRMATIONS) return { ok: false, reason: EVM_PENDING };
  let amount: bigint;
  try { amount = BigInt(args.amountBaseUnits); } catch { return { ok: false, reason: "Order has an invalid FR amount" }; }
  const expectedData = `${erc20.encodeFunctionData("transfer", [args.destination, amount])}${Buffer.from(toUtf8Bytes(args.reference)).toString("hex")}`;
  if (!tx.to || getAddress(tx.to) !== getAddress(args.tokenContract) || tx.value !== 0n || tx.data.toLowerCase() !== expectedData.toLowerCase()) {
    return { ok: false, reason: "Transaction does not match this FR payment quote" };
  }
  const payer = getAddress(tx.from);
  if (args.expectedPayer && (!isAddress(args.expectedPayer) || getAddress(args.expectedPayer) !== payer)) return { ok: false, reason: "Payment was sent by a different wallet" };
  const payerTopic = `0x${payer.slice(2).toLowerCase().padStart(64, "0")}`;
  const destinationTopic = `0x${getAddress(args.destination).slice(2).toLowerCase().padStart(64, "0")}`;
  const matchingTransfer = receipt.logs.some((log) =>
    getAddress(log.address) === getAddress(args.tokenContract) &&
    log.topics[0]?.toLowerCase() === transferTopic.toLowerCase() &&
    log.topics[1]?.toLowerCase() === payerTopic &&
    log.topics[2]?.toLowerCase() === destinationTopic &&
    BigInt(log.data) === amount,
  );
  if (!matchingTransfer) return { ok: false, reason: "No exact FR transfer was found in this transaction" };
  if (args.quoteExpiresAt) {
    const block = await rpc().getBlock(receipt.blockNumber);
    if (!block || block.timestamp * 1000 > args.quoteExpiresAt.getTime()) return { ok: false, reason: "Payment was mined after the quote expired" };
  }
  return { ok: true, payer };
}

export function formatEthAmount(amountBaseUnits: bigint): string {
  return formatEther(amountBaseUnits);
}

export function evmClaimKey(hash: string): string {
  return `evm:${ROBINHOOD_CHAIN_ID}:${hash.toLowerCase()}`;
}