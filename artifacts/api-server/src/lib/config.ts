// Centralized runtime configuration for the ICPX backend.
// Secrets/env are read once here so routes and libs share a single source.
import { PublicKey } from "@solana/web3.js";

export const VAST_API_KEY = process.env.VAST_API_KEY ?? "";
// v1 is only required for /instances/; bundles (search) and asks (create) are still v0.
export const VAST_API_BASE = "https://console.vast.ai/api/v1";
export const VAST_API_BASE_V0 = "https://console.vast.ai/api/v0";
export const VAST_DEFAULT_IMAGE = process.env.VAST_DEFAULT_IMAGE ?? "pytorch/pytorch:latest";
export const VAST_DEFAULT_DISK_GB = Number(process.env.VAST_DEFAULT_DISK_GB ?? "30");

// Solana
export const SOLANA_NETWORK = process.env.SOLANA_NETWORK ?? "mainnet-beta";
export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

// Wallet that receives crypto payments (public address; configured by the operator)
export const PAYMENT_WALLET = process.env.ICPX_PAYMENT_WALLET ?? "";
export const PAYMENT_CURRENCY = "SOL";

// Cookie Chain is Solana-compatible but has its own native asset and RPC.
// Keep the destination explicit: the legacy ICPX wallet is only a development
// fallback so an existing deployment does not silently send COOK to an EVM
// address. Production operators should set COOKIE_PAYMENT_WALLET.
export const COOKIE_CHAIN_RPC_URL =
  process.env.COOKIE_CHAIN_RPC_URL ?? "https://rpc.cookiescan.io";
export const COOKIE_CHAIN_EXPLORER_URL =
  process.env.COOKIE_CHAIN_EXPLORER_URL ?? "https://cookiescan.io";
export const COOKIE_PAYMENT_WALLET =
  process.env.COOKIE_PAYMENT_WALLET ?? PAYMENT_WALLET;
export const COOKIE_PAYMENT_CURRENCY = "COOK";
export const COOKIE_COOK_DECIMALS = 9;
// Cookie Chain's native asset has no mint address. Pricing is read from the
// configured market reference so we never guess between unrelated COOK tokens.
export const COOKIE_COOK_PRICE_MINT =
  process.env.COOKIE_COOK_PRICE_MINT ?? "";
export const COOKIE_QUOTE_TTL_MS = Number(
  process.env.COOKIE_QUOTE_TTL_MS ?? String(30 * 60 * 1000),
);
// Native SOL on Cookie Chain is an optional fallback payment rail. It carries a
// premium so COOK remains the preferred checkout asset.
export const COOKIE_SOL_PREMIUM_MULTIPLIER = Number(
  process.env.SOL_PAYMENT_PREMIUM_MULTIPLIER ??
    process.env.COOKIE_SOL_PREMIUM_MULTIPLIER ??
    "1.25",
);

// Robinhood Chain mainnet (EVM). Never reuse the legacy Solana receiver here:
// the configured EVM address must be a distinct, valid public address.
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_NAME = "Robinhood Chain Mainnet";
export const ROBINHOOD_PAYMENT_WALLET =
  process.env.ROBINHOOD_PAYMENT_WALLET ?? "";
export const ROBINHOOD_RPC_URL = process.env.ROBINHOOD_RPC_URL ?? "";
export const ROBINHOOD_PUBLIC_RPC_URL =
  "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER_URL =
  process.env.ROBINHOOD_EXPLORER_URL ?? "https://explorer.mainnet.chain.robinhood.com";
export const ROBINHOOD_QUOTE_TTL_MS = Number(
  process.env.ROBINHOOD_QUOTE_TTL_MS ?? String(30 * 60 * 1000),
);
export const ROBINHOOD_PAYMENT_CONFIRMATIONS = Number(
  process.env.ROBINHOOD_PAYMENT_CONFIRMATIONS ?? "2",
);

// Future ERC-20 checkout is intentionally locked until all pricing and discount
// inputs are explicitly configured and audited. No default contract, price,
// decimals, or discount is invented.
export const ROBINHOOD_TOKEN_CONTRACT =
  process.env.ROBINHOOD_TOKEN_CONTRACT ?? "";
export const ROBINHOOD_TOKEN_DECIMALS = process.env.ROBINHOOD_TOKEN_DECIMALS;
export const ROBINHOOD_TOKEN_POOL_ID = process.env.ROBINHOOD_TOKEN_POOL_ID ?? "";
export const ROBINHOOD_TOKEN_HOOK = process.env.ROBINHOOD_TOKEN_HOOK ?? "";
export const ROBINHOOD_TOKEN_DISCOUNT_BPS =
  process.env.ROBINHOOD_TOKEN_DISCOUNT_BPS;

// $ICPX SPL token mint. Empty until the token launches on-chain. SOL stays the
// rental payment currency while this is empty; once the operator sets the mint,
// isTokenLive() flips true and the UI/checkout can switch to $ICPX. No SPL
// payment path is built yet — this is the single seam that gates that switch.
export const ICPX_TOKEN_MINT = process.env.ICPX_TOKEN_MINT ?? "";

// $ICPX is an spl-token-2022 mint with 6 decimals (verified on-chain). Raw base
// units = display amount * 10^ICPX_TOKEN_DECIMALS.
export const ICPX_TOKEN_DECIMALS = Number(process.env.ICPX_TOKEN_DECIMALS ?? "6");

// How long an ICPX quote stays valid. The locked token amount is computed from a
// live price at quote time; because $ICPX is volatile, a stale quote could let a
// buyer pay a token amount worth far less USD than the rental. We bound this by
// the on-chain payment time (not confirm time) so an honest buyer who paid in
// time is never rejected for confirming late.
export const ICPX_QUOTE_TTL_MS = Number(
  process.env.ICPX_QUOTE_TTL_MS ?? String(30 * 60 * 1000),
);

// White-label margin applied on top of the live Vast.ai market price.
export const ICPX_MARKUP = Number(process.env.ICPX_MARKUP ?? "1.75");

// Extra persistent disk pricing (USD per GB-month), converted to an hourly rate
// at quote time. Layered on top of the compute price when a renter adds disk
// beyond the template's bundled default.
export const DISK_USD_PER_GB_MONTH = Number(
  process.env.ICPX_DISK_USD_PER_GB_MONTH ?? "0.20",
);

// Hard ceiling on additional disk a renter can request (GB). Bounds the quote
// and the provisioned volume so a typo can't ask for a multi-TB disk.
export const MAX_EXTRA_DISK_GB = Number(process.env.ICPX_MAX_EXTRA_DISK_GB ?? "500");

// Minimum charge per rental order (USD). Set to 0: renters are charged exactly
// the computed subtotal, with no floor. Kept configurable in case a future
// floor is needed to cover fixed provisioning overhead on tiny/short rentals.
export const ORDER_MINIMUM_USD = Number(process.env.ICPX_ORDER_MIN_USD ?? "0");

// Instance-type price multipliers applied to the compute price:
//   on-demand — baseline, dedicated capacity.
//   spot      — interruptible (a bid is placed on Vast); cheapest.
//   reserved  — committed-capacity discount, dedicated like on-demand.
export const INSTANCE_TYPE_MULTIPLIER: Record<string, number> = {
  "on-demand": 1.0,
  spot: 0.6,
  reserved: 0.9,
};

// Creator marketplace. Buyers pay SOL/$ICPX (which goes 100% to the platform
// PAYMENT_WALLET, same as rentals); the seller is compensated in off-chain ICPX
// *points*. POINTS_PER_USD converts a USD sale price into points; the platform
// keeps MARKETPLACE_FEE_BPS (basis points) of that value as its cut. So a seller
// nets priceUsd * POINTS_PER_USD * (10000 - MARKETPLACE_FEE_BPS) / 10000 points.
export const POINTS_PER_USD = Number(process.env.ICPX_POINTS_PER_USD ?? "100");
export const MARKETPLACE_FEE_BPS = Number(
  process.env.ICPX_MARKETPLACE_FEE_BPS ?? "2000",
);
// Listing price bounds (USD). Guards against zero/negative and absurd prices.
export const MARKETPLACE_MIN_PRICE_USD = Number(
  process.env.ICPX_MARKETPLACE_MIN_PRICE_USD ?? "1",
);
export const MARKETPLACE_MAX_PRICE_USD = Number(
  process.env.ICPX_MARKETPLACE_MAX_PRICE_USD ?? "10000",
);

// Email
export const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "ICPX <onboarding@resend.dev>";
export const ADMIN_EMAIL = process.env.ICPX_ADMIN_EMAIL ?? "";

// Rewards: secret used to sign stateless wallet-auth challenges and sessions.
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

// Developer API: requests-per-minute allowed per API key. Enforced best-effort
// in-process (single instance); see lib/apiKeys.ts.
export const API_KEY_RATE_LIMIT_PER_MIN = Number(
  process.env.ICPX_API_KEY_RATE_LIMIT_PER_MIN ?? "60",
);

export function isVastConfigured(): boolean {
  return VAST_API_KEY.length > 0;
}

export function isPaymentConfigured(): boolean {
  return PAYMENT_WALLET.length > 0;
}

export function isCookiePaymentConfigured(): boolean {
  let validWallet = false;
  try {
    new PublicKey(COOKIE_PAYMENT_WALLET);
    validWallet = true;
  } catch {
    validWallet = false;
  }
  return (
    validWallet &&
    COOKIE_CHAIN_RPC_URL.length > 0
  );
}

export function robinhoodRpcUrl(): string | null {
  if (ROBINHOOD_RPC_URL) return ROBINHOOD_RPC_URL;
  // Public RPC is acceptable only for local/development use. Production must
  // explicitly configure a dedicated RPC endpoint and fails closed otherwise.
  return process.env.NODE_ENV === "production" ? null : ROBINHOOD_PUBLIC_RPC_URL;
}

export function isRobinhoodPaymentConfigured(): boolean {
  return ROBINHOOD_PAYMENT_WALLET.length > 0 && robinhoodRpcUrl() !== null;
}

export function tokenLockReason(): string {
  if (!ROBINHOOD_TOKEN_CONTRACT) return "TOKEN payments are locked: token contract is not configured.";
  if (ROBINHOOD_TOKEN_DECIMALS === undefined) return "TOKEN payments are locked: token decimals are not configured.";
  if (!ROBINHOOD_TOKEN_POOL_ID) return "TOKEN payments are locked: the live Uniswap V4 pool is not configured.";
  if (!ROBINHOOD_TOKEN_HOOK) return "TOKEN payments are locked: the Uniswap V4 hook is not configured.";
  if (ROBINHOOD_TOKEN_DISCOUNT_BPS === undefined) return "TOKEN payments are locked: token discount is not configured.";
  return "TOKEN payments are locked: EVM payments are not configured.";
}

export function isRobinhoodTokenPaymentConfigured(): boolean {
  return (
    isRobinhoodPaymentConfigured() &&
    /^0x[0-9a-fA-F]{40}$/.test(ROBINHOOD_TOKEN_CONTRACT) &&
    /^\d+$/.test(ROBINHOOD_TOKEN_DECIMALS ?? "") &&
    /^0x[0-9a-fA-F]{64}$/.test(ROBINHOOD_TOKEN_POOL_ID) &&
    /^0x[0-9a-fA-F]{40}$/.test(ROBINHOOD_TOKEN_HOOK) &&
    Number.isInteger(Number(ROBINHOOD_TOKEN_DISCOUNT_BPS)) &&
    Number(ROBINHOOD_TOKEN_DISCOUNT_BPS) >= 0 &&
    Number(ROBINHOOD_TOKEN_DISCOUNT_BPS) < 10_000
  );
}

export function isAnyPaymentConfigured(): boolean {
  return isPaymentConfigured() || isRobinhoodPaymentConfigured();
}

// True once the $ICPX token mint is configured (token has launched on-chain).
export function isTokenLive(): boolean {
  return ICPX_TOKEN_MINT.length > 0;
}

export function isRewardsConfigured(): boolean {
  return SESSION_SECRET.length > 0;
}
