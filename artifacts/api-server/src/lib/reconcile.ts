// Background reconciliation for payments that were approved on-chain but whose
// /confirm call never completed (the buyer closed the tab, lost connectivity, or
// the confirmation landed after a timeout). When /confirm sees a broadcast-but-
// unconfirmed signature it stamps it on the NON-unique submittedTxSignature
// column as a safety net but leaves the order pending. Nothing ever retried it,
// so the money moved but the buyer never got their download/instance. This job
// closes that gap: it finds pending orders carrying a submitted signature,
// re-verifies the payment on-chain, and finalizes them with the exact same
// atomic-claim + deterministic-idempotency-key path the interactive route uses,
// so a settled order can never double-credit or double-provision.
import { and, eq, isNull, isNotNull, lt, sql } from "drizzle-orm";
import {
  db,
  rentalsTable,
  purchasesTable,
  listingsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { isPaymentConfigured } from "./config";
import { creditSeller } from "./marketplace";
import {
  verifyWorkspacePayment,
  verifyPurchasePayment,
  provisionWorkspace,
  notifyWorkspaceSettled,
  claimSignatureAndSettle,
} from "./settlement";
import { notifyAdmin, esc } from "./email";
import { normalizeWalletForStorage } from "./walletAuth";

// How often the loop runs. Long enough to be cheap (each pass makes a few RPC
// calls per stranded order), short enough that a buyer who closed the tab gets
// their instance/download within a couple of minutes.
const RECONCILE_INTERVAL_MS = Number(
  process.env.ICPX_RECONCILE_INTERVAL_MS ?? String(2 * 60 * 1000),
);
// Don't touch orders younger than this — give the buyer's own /confirm polling a
// chance to finish first so we don't race it for the common (happy) path.
const RECONCILE_MIN_AGE_MS = Number(
  process.env.ICPX_RECONCILE_MIN_AGE_MS ?? String(60 * 1000),
);
// Bound the work per pass so a backlog can't make one tick run unbounded.
const RECONCILE_BATCH = 20;
// A paid workspace that still has no instance after this long almost certainly needs
// operator attention (no capacity for the model, or Vast rejecting every ask).
const STUCK_PROVISION_ALERT_MS = Number(
  process.env.ICPX_STUCK_PROVISION_ALERT_MS ?? String(15 * 60 * 1000),
);
// Alert the operator once per stuck workspace. In-memory: resets on restart, which
// at worst re-alerts a still-stuck order after a deploy — acceptable, and avoids
// a schema change just for de-duping notifications.
const alertedStuck = new Set<number>();

// Settle pending marketplace purchases that carry a broadcast signature. Mirrors
// POST /marketplace/purchases/:id/confirm minus the HTTP wrapper.
async function reconcilePurchases(cutoff: Date): Promise<number> {
  const pending = await db
    .select()
    .from(purchasesTable)
    .where(
      and(
        eq(purchasesTable.paymentStatus, "pending"),
        isNotNull(purchasesTable.submittedTxSignature),
        isNull(purchasesTable.paymentTxSignature),
        lt(purchasesTable.createdAt, cutoff),
      ),
    )
    .limit(RECONCILE_BATCH);

  let settled = 0;
  for (const purchase of pending) {
    const signature = purchase.submittedTxSignature;
    if (!signature) continue;

    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, purchase.listingId))
      .limit(1);
    // Defensive: a seller can never settle their own listing, and a missing
    // listing has nothing to settle.
    if (!listing || listing.sellerAccountId === purchase.buyerAccountId) continue;

    let verification;
    try {
      verification = await verifyPurchasePayment(purchase, signature);
    } catch (err) {
      logger.warn({ err, id: purchase.id }, "reconcile: purchase verify errored");
      continue;
    }
    if (!verification.ok) {
      // Still not confirmed (or genuinely never landed) — leave it pending for a
      // later pass. Only log non-transient reasons to avoid noise.
      if (verification.reason !== "Transaction not found or not yet confirmed") {
        logger.warn(
          { id: purchase.id, reason: verification.reason },
          "reconcile: purchase payment still not settleable",
        );
      }
      continue;
    }

    // Settle through the shared system-wide claim primitive (single-use across
    // BOTH purchases and rentals), so the reconciler can't settle a signature
    // already consumed by a rental and can't diverge from the confirm route.
    const outcome = await claimSignatureAndSettle(
      signature,
      { kind: "purchase", id: purchase.id },
      (tx) =>
        tx
          .update(purchasesTable)
          .set({
            paymentStatus: "paid",
            paymentTxSignature: signature,
            payerWallet:
              normalizeWalletForStorage(verification.payer) ??
              normalizeWalletForStorage(purchase.payerWallet),
          })
          .where(
            and(
              eq(purchasesTable.id, purchase.id),
              eq(purchasesTable.paymentStatus, "pending"),
            ),
          )
          .returning()
          .then((rows) => rows[0]),
    );

    if (outcome.status === "conflict") {
      logger.warn(
        { id: purchase.id },
        "reconcile: purchase signature already used by another order",
      );
      continue;
    }
    if (outcome.status !== "settled") continue; // claimed concurrently

    await db
      .update(listingsTable)
      .set({ salesCount: sql`${listingsTable.salesCount} + 1` })
      .where(eq(listingsTable.id, listing.id));

    try {
      await creditSeller(listing, purchase.id, outcome.row.priceUsd);
    } catch (err) {
      logger.error({ err, id: purchase.id }, "reconcile: seller credit failed");
    }

    settled++;
    logger.info({ id: purchase.id, listingId: listing.id }, "reconcile: purchase settled");
  }
  return settled;
}

// Settle pending workspaces that carry a broadcast signature, then provision them.
// Also retries provisioning for already-paid workspaces stuck without an instance
// (e.g. a provisioning failure during the original confirm), since provisioning
// is idempotent. Mirrors POST /workspaces/:id/confirm minus the HTTP wrapper.
async function reconcileWorkspaces(cutoff: Date): Promise<number> {
  const pending = await db
    .select()
    .from(rentalsTable)
    .where(
      and(
        eq(rentalsTable.paymentStatus, "pending"),
        isNotNull(rentalsTable.submittedTxSignature),
        isNull(rentalsTable.paymentTxSignature),
        lt(rentalsTable.createdAt, cutoff),
      ),
    )
    .limit(RECONCILE_BATCH);

  let settled = 0;
  for (const rental of pending) {
    const signature = rental.submittedTxSignature;
    if (!signature) continue;

    let verification;
    try {
      verification = await verifyWorkspacePayment(rental, signature);
    } catch (err) {
      logger.warn({ err, workspaceId: rental.id }, "reconcile: workspace verification errored");
      continue;
    }
    if (!verification.ok) {
      if (verification.reason !== "Transaction not found or not yet confirmed") {
        logger.warn(
          { workspaceId: rental.id, reason: verification.reason },
          "reconcile: workspace payment still not settleable",
        );
      }
      continue;
    }

    // Settle through the shared system-wide claim primitive (single-use across
    // BOTH workspaces and purchases), so the reconciler can't settle a signature
    // already consumed by a purchase and can't diverge from the confirm route.
    const outcome = await claimSignatureAndSettle(
      signature,
      { kind: "rental", id: rental.id },
      (tx) =>
        tx
          .update(rentalsTable)
          .set({
            paymentStatus: "paid",
            paymentTxSignature: signature,
            status: "provisioning",
            payerWallet:
              normalizeWalletForStorage(verification.payer) ??
              normalizeWalletForStorage(rental.payerWallet),
          })
          .where(
            and(
              eq(rentalsTable.id, rental.id),
              eq(rentalsTable.paymentStatus, "pending"),
            ),
          )
          .returning()
          .then((rows) => rows[0]),
    );

    if (outcome.status === "conflict") {
      logger.warn(
        { workspaceId: rental.id },
        "reconcile: workspace payment signature already used by another order",
      );
      continue;
    }
    if (outcome.status !== "settled") continue; // claimed concurrently

    const provisioned = await provisionWorkspace(outcome.row, logger);
    notifyWorkspaceSettled(provisioned, logger);

    settled++;
    logger.info({ workspaceId: rental.id }, "reconcile: workspace settled");
  }

  // Self-heal paid workspaces whose provisioning never completed (no notify — they
  // were already announced when first marked paid).
  const stuck = await db
    .select()
    .from(rentalsTable)
    .where(
      and(
        eq(rentalsTable.paymentStatus, "paid"),
        eq(rentalsTable.status, "provisioning"),
        isNull(rentalsTable.vastInstanceId),
      ),
    )
    .limit(RECONCILE_BATCH);
  for (const rental of stuck) {
    const ageMs = Date.now() - rental.createdAt.getTime();
    if (ageMs > STUCK_PROVISION_ALERT_MS && !alertedStuck.has(rental.id)) {
      alertedStuck.add(rental.id);
      void notifyAdmin(
        "ForgeRun workspace stuck provisioning",
        `<p>Workspace #${rental.id} · ${esc(rental.gpuModel)} · ${rental.durationHours}h was paid ${Math.round(ageMs / 60000)} min ago but still has no Vast instance.</p>
         <p>Likely no available capacity for this model, or the host keeps rejecting the ask. Provision a machine manually or refund the buyer.</p>
         <p>Payer: <code>${esc(rental.payerWallet ?? "unknown")}</code></p>`,
      ).catch((err) => {
        // A failed send must not permanently suppress the alert — drop the id so
        // the next pass retries instead of waiting for a process restart.
        alertedStuck.delete(rental.id);
        logger.error(
          { err, workspaceId: rental.id },
          "reconcile: stuck-workspace admin alert failed",
        );
      });
      logger.warn(
        { workspaceId: rental.id, ageMs },
        "reconcile: workspace stuck provisioning, operator alerted",
      );
    }
    const updated = await provisionWorkspace(rental, logger);
    if (updated.vastInstanceId) {
      alertedStuck.delete(rental.id);
      settled++;
      logger.info({ workspaceId: rental.id }, "reconcile: stuck workspace provisioned");
    }
  }

  return settled;
}

// One reconciliation pass over both payment surfaces. Fail-soft: an error in one
// surface never blocks the other or crashes the loop.
export async function runReconciliation(): Promise<void> {
  if (!isPaymentConfigured()) return;
  const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MS);

  try {
    const n = await reconcilePurchases(cutoff);
    if (n > 0) logger.info({ count: n }, "reconcile: purchases settled this pass");
  } catch (err) {
    logger.error({ err }, "reconcile: purchase pass failed");
  }

  try {
    const n = await reconcileWorkspaces(cutoff);
    if (n > 0) logger.info({ count: n }, "reconcile: workspaces settled this pass");
  } catch (err) {
    logger.error({ err }, "reconcile: workspace pass failed");
  }
}

// Start the periodic reconciliation loop. unref()'d so it never keeps the
// process alive on its own. Returns the timer so a caller could stop it.
export function startReconciliationLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runReconciliation();
  }, RECONCILE_INTERVAL_MS);
  timer.unref();
  logger.info(
    { intervalMs: RECONCILE_INTERVAL_MS },
    "payment reconciliation loop started",
  );
  return timer;
}
