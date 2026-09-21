import { Router, type IRouter } from "express";
import { COOKIE_CHAIN_RPC_URL, SOLANA_RPC_URL } from "../lib/config";

const router: IRouter = Router();

// Methods the rental pay flow + wallet adapters actually need. Anything else
// (getProgramAccounts, getBlock, getTransaction, getSignaturesForAddress, …) is
// rejected so this proxy can't be abused as a free mainnet relay or to burn the
// operator's RPC quota with heavy queries.
const ALLOWED_METHODS = new Set([
  "getLatestBlockhash",
  "getBlockHeight",
  "getSlot",
  "getSignatureStatuses",
  "sendTransaction",
  "simulateTransaction",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getAccountInfo",
  "getBalance",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "getVersion",
  "getHealth",
]);

function methodsAllowed(body: unknown): boolean {
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0) return false;
  return items.every((it) => {
    const method = (it as { method?: unknown } | null)?.method;
    return typeof method === "string" && ALLOWED_METHODS.has(method);
  });
}

async function callRpc(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Browser-facing Solana JSON-RPC proxy.
//
// Forward the browser's SVM JSON-RPC calls server-side. The browser never
// receives a private RPC URL. `network=solana` is only used by the SOL rail.
router.post("/solana-rpc", async (req, res): Promise<void> => {
  if (!methodsAllowed(req.body)) {
    res.status(400).json({ error: "Unsupported RPC method" });
    return;
  }
  try {
    const upstream = await callRpc(
      req.query.network === "solana" ? SOLANA_RPC_URL : COOKIE_CHAIN_RPC_URL,
      req.body,
    );

    const text = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get("content-type") ?? "application/json")
      .send(text);
  } catch (err) {
    req.log.error({ err }, "solana rpc proxy failed");
    res.status(502).json({ error: "Solana RPC is unavailable" });
  }
});

export default router;
