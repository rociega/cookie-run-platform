import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  createPurchase,
  confirmPurchase,
  getPurchaseDownload,
  useGetPaymentConfig,
  useGetListingReviews,
  type ListingPublic,
  type Purchase,
} from "@workspace/api-client-react";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  Download,
  Cpu,
} from "lucide-react";
import Modal from "./Modal";
import ConnectWalletButton from "./ConnectWalletButton";
import { StarRating } from "./Stars";
import { useRewardsAuth } from "@/lib/rewardsAuth";
import { useIcpx } from "@/lib/icpx";
import {
  buildEvmTransaction,
  checkEvmFunds,
  describeEvmPayError,
  type EvmPaymentQuote,
  waitForEvmConfirmation,
} from "@/lib/evmPay";
import { useEvmWallet } from "@/lib/wallet";

type Step =
  | "config"
  | "creating"
  | "quote"
  | "paying"
  | "confirming"
  | "confirm_failed"
  | "success";

const CATEGORY_LABEL: Record<string, string> = {
  model: "Model / LoRA",
  dataset: "Dataset",
  template: "Template / Workflow",
};

function shortKey(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function formatBytes(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function BuyModal({
  open,
  listing,
  onClose,
  onPurchased,
}: {
  open: boolean;
  listing: ListingPublic | null;
  onClose: () => void;
  onPurchased?: () => void;
}) {
  const { address, connected, provider, solanaProvider, sendTransactionOnNetwork } = useEvmWallet();
  const { data: paymentConfig } = useGetPaymentConfig();
  const evmPaymentConfig = paymentConfig as (typeof paymentConfig & {
    paymentReady?: boolean;
    solPaymentReady?: boolean;
    tokenReady?: boolean;
    tokenLockReason?: string | null;
    chainId?: number;
  }) | undefined;
  const paymentReady = evmPaymentConfig?.paymentReady === true;
  const solPaymentReady = evmPaymentConfig?.solPaymentReady === true;
  const tokenLockReason = evmPaymentConfig?.tokenLockReason || "Cookie Run token payments launch after the token contract and launch discount are configured.";
  const {
    isAuthed,
    canSign,
    signingIn,
    signIn,
    error: authError,
    invalidateSession,
  } = useRewardsAuth();
  const { openRentWith } = useIcpx();

  const { data: reviews } = useGetListingReviews(listing?.id ?? 0);

  const [currency, setCurrency] = useState<"COOK" | "SOL">("COOK");
  const [step, setStep] = useState<Step>("config");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const signatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("config");
      setPurchase(null);
      setError(null);
      setDownloading(false);
      signatureRef.current = null;
    }
  }, [open, listing?.id]);

  function close() {
    onClose();
    setTimeout(() => {
      setStep("config");
      setPurchase(null);
      setError(null);
      setDownloading(false);
      signatureRef.current = null;
    }, 250);
  }

  async function startPurchase() {
    if (!listing) return;
    if (!address) {
       setError("Connect Nightly Wallet before requesting a Cookie Chain quote.");
      return;
    }
    setStep("creating");
    setError(null);
    try {
       if (!(currency === "SOL" ? solPaymentReady : paymentReady)) {
         setError(`${currency} payments on Cookie Chain are not configured yet. Please try again shortly.`);
        setStep("config");
        return;
      }
      const p = await createPurchase(listing.id, {
        currency: currency as never,
        payerWallet: address ?? undefined,
      });
      setPurchase(p);
      setStep("quote");
    } catch (e) {
      // A stale bearer token surfaces as a 401 — drop the session so the gate
      // reappears and the buyer can re-sign.
      if ((e as { status?: number })?.status === 401) invalidateSession();
      setError(describeEvmPayError(e));
      setStep("config");
    }
  }

  async function pay() {
    if (!purchase || !address || !provider) return;
    setError(null);
    // Reuse an already-sent payment if a prior confirm failed, so retrying
    // confirmation never sends a second on-chain transfer.
    let sig = signatureRef.current;
    try {
       if (!(purchase.currency === "SOL" ? solPaymentReady : paymentReady)) throw new Error(`${purchase.currency} payments are not configured yet.`);
      if (!sig) {
        const tx = buildEvmTransaction(address, purchase as Purchase & EvmPaymentQuote);
         const networkProvider = currency === "SOL" ? solanaProvider : provider;
         if (!networkProvider) throw new Error("Payment network is unavailable.");
         const preflightError = await checkEvmFunds(networkProvider, tx, purchase as Purchase & EvmPaymentQuote);
        if (preflightError) {
          setError(preflightError);
          setStep("quote");
          return;
        }

        setStep("paying");
         sig = await sendTransactionOnNetwork(tx, currency === "SOL" ? "solana" : "cookie");
        signatureRef.current = sig;

        setStep("confirming");
        // Record the signature server-side the instant it broadcasts so a paid
        // purchase is never orphaned if confirmation is slow or the tab closes.
        void confirmPurchase(purchase.id, { signature: sig }).catch(() => {});
         await waitForEvmConfirmation(networkProvider, sig);
      }

      setStep("confirming");
      const confirmed = await confirmPurchase(purchase.id, { signature: sig });
      setPurchase(confirmed);
      setStep("success");
      onPurchased?.();
    } catch (e) {
      // A stale token on confirm surfaces as 401 — drop the session so the gate
      // reappears instead of trapping the buyer in a retry loop.
      if ((e as { status?: number })?.status === 401) invalidateSession();
      setError(describeEvmPayError(e));
      setStep(sig ? "confirm_failed" : "quote");
    }
  }

  async function download() {
    if (!purchase) return;
    setDownloading(true);
    setError(null);
    try {
      const grant = await getPurchaseDownload(purchase.id);
      window.open(grant.downloadURL, "_blank", "noopener,noreferrer");
    } catch (e) {
      if ((e as { status?: number })?.status === 401) invalidateSession();
      setError(describeEvmPayError(e));
    } finally {
      setDownloading(false);
    }
  }

  function launchRental() {
    const tid = purchase?.suggestedTemplateId;
    if (!tid) return;
    close();
    setTimeout(() => openRentWith({ templateId: tid }), 300);
  }

  const fileSize = formatBytes(listing?.fileSizeBytes);

  return (
    <Modal open={open} onClose={close} title="Buy Asset" maxWidth={460}>
      {listing && (
        <>
          {/* Listing summary */}
          <div className="mb-5 border border-white/10">
            <div className="px-3 py-3">
              <div className="font-mono text-[9px] tracking-[0.25em] uppercase text-primary mb-1">
                {CATEGORY_LABEL[listing.category] ?? listing.category}
              </div>
              <div
                className="font-bold text-[15px] tracking-tight leading-tight"
                data-testid="text-buy-title"
              >
                {listing.title}
              </div>
              {listing.description && (
                <p className="font-mono text-[11px] text-muted-foreground mt-2 leading-relaxed line-clamp-3">
                  {listing.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2.5 font-mono text-[10px] text-muted-foreground/70">
                <span>by {listing.sellerHandle || listing.sellerWallet}</span>
                {listing.fileName && (
                  <span className="truncate">· {listing.fileName}</span>
                )}
                {fileSize && <span>· {fileSize}</span>}
              </div>
              {listing.avgRating != null && (listing.reviewCount ?? 0) > 0 ? (
                <div
                  className="flex items-center gap-2 mt-2.5"
                  data-testid="buy-rating"
                >
                  <StarRating value={listing.avgRating} size={13} />
                  <span className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">
                    {listing.avgRating.toFixed(1)} · {listing.reviewCount}{" "}
                    {listing.reviewCount === 1 ? "review" : "reviews"}
                  </span>
                </div>
              ) : (
                <div className="font-mono text-[10px] text-muted-foreground/40 mt-2.5 tracking-wider uppercase">
                  No reviews yet
                </div>
              )}
            </div>

            {reviews && reviews.length > 0 && (
              <div
                className="px-3 py-3 max-h-44 overflow-y-auto overscroll-contain space-y-3"
                style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
                data-testid="buy-reviews-list"
              >
                {reviews.map((r) => (
                  <div key={r.id} data-testid={`review-${r.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <StarRating value={r.rating} size={11} />
                      <span className="font-mono text-[9px] text-muted-foreground/50 truncate">
                        {r.buyerHandle || r.buyerWallet}
                      </span>
                    </div>
                    {r.body && (
                      <p className="font-mono text-[11px] text-muted-foreground/80 mt-1.5 leading-relaxed">
                        {r.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Not signed in → gate */}
          {!isAuthed ? (
            <div>
              <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-4">
                {connected
                  ? "Sign a free message to prove you own this wallet. Your purchase and download are tied to it."
                  : "Connect your wallet to buy. Your purchase and gated download are tied to the wallet you sign in with."}
              </p>
              {!connected ? (
                <ConnectWalletButton className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full flex items-center justify-center gap-2" />
              ) : (
                <button
                  onClick={() => void signIn()}
                  disabled={!canSign || signingIn}
                  data-testid="button-buy-sign-in"
                  className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {signingIn ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {signingIn ? "Check your wallet…" : "Sign in with wallet"}
                </button>
              )}
              {!connected ? null : !canSign ? (
                <p className="font-mono text-[11px] text-destructive mt-3">
                  This wallet can't sign messages. Try Phantom, Solflare, or Backpack.
                </p>
              ) : null}
              {authError && (
                <p className="font-mono text-[11px] text-destructive mt-3">
                  {authError}
                </p>
              )}
            </div>
          ) : step === "success" && purchase ? (
            <div className="text-center py-2">
              <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-4" />
              <p className="font-black text-[18px] tracking-tight mb-2">
                Purchase confirmed.
              </p>
              <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-5">
                You now own “{purchase.listingTitle}”. Your download link is
                private and expires shortly after you open it — grab it again
                anytime from My Purchases.
              </p>
              {error && (
                <p className="font-mono text-[11px] text-destructive mb-3">{error}</p>
              )}
              <button
                onClick={() => void download()}
                disabled={downloading}
                data-testid="button-buy-download"
                className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading ? "Preparing download…" : "Download file"}
              </button>

              {purchase.category === "template" && purchase.suggestedTemplateId && (
                <button
                  onClick={launchRental}
                  data-testid="button-buy-launch-rental"
                  className="premium-btn-ghost font-mono font-bold text-[11px] tracking-widest uppercase px-6 py-3 w-full mt-3 flex items-center justify-center gap-2"
                >
                  <Cpu className="h-4 w-4" /> Launch in a workspace
                </button>
              )}

              <div className="flex items-center justify-center gap-3 mt-4">
                <Link
                  href="/marketplace?tab=purchases"
                  onClick={close}
                  data-testid="link-my-purchases"
                  className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
                >
                  View my purchases
                </Link>
              </div>
            </div>
          ) : step === "config" || step === "creating" ? (
            <>
              <div className="mb-5">
                <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
                  Pay with
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="option-buy-currency-cook"
                    className="premium-btn font-mono text-[12px] font-bold py-2.5 transition-colors"
                  >
                    COOK
                  </button>
                   <button
                     type="button"
                     data-testid="option-buy-currency-sol"
                     className={`premium-btn font-mono text-[12px] font-bold py-2.5 transition-colors ${currency === "SOL" ? "" : "opacity-60"}`}
                     onClick={() => setCurrency("SOL")}
                   >
                     SOL <span className="block text-[9px] tracking-widest uppercase opacity-70">+25% · Cookie Chain</span>
                   </button>
                </div>
              </div>

              <div className="flex items-baseline justify-between mb-5 px-1">
                <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
                  Price
                </span>
                <span className="font-mono font-black text-[24px] text-primary tabular-nums">
                  ${listing.priceUsd}
                </span>
              </div>

              {error && (
                <p
                  className="font-mono text-[11px] text-destructive mb-3"
                  data-testid="text-buy-error"
                >
                  {error}
                </p>
              )}

              <button
                onClick={() => void startPurchase()}
                disabled={step === "creating"}
                data-testid="button-buy-continue"
                className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {step === "creating" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Fetching live price…
                  </>
                ) : (
                  "Continue to payment"
                )}
              </button>
            </>
          ) : (
            purchase && (
              <>
                <div
                  className="space-y-0 mb-5 border border-white/10"
                >
                  {(() => {
                    const rows: [string, string][] = [
                      ["Asset", purchase.listingTitle],
                      ["Type", CATEGORY_LABEL[purchase.category] ?? purchase.category],
                     ["Price", `$${purchase.priceUsd} USD${purchase.currency === "SOL" ? " · +25% SOL rail" : ""}`],
                      ["Pay to", shortKey(purchase.destination)],
                    ];
                    return rows.map(([k, v], i) => (
                      <div
                        key={k}
                        className="flex justify-between px-3 py-2.5 font-mono text-[12px] gap-3"
                        style={
                          i < rows.length - 1
                            ? { borderBottom: "1px solid rgba(255,255,255,0.06)" }
                            : {}
                        }
                      >
                        <span className="text-muted-foreground shrink-0">{k}</span>
                        <span className="font-bold truncate text-right">{v}</span>
                      </div>
                    ));
                  })()}
                </div>

                <div className="flex items-baseline justify-between mb-5 px-1">
                  <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
                    Total
                  </span>
                  <span className="font-mono font-black text-[26px] text-primary tabular-nums">
                     {purchase.currency === "COOK" || purchase.currency === "SOL"
                       ? `${purchase.solAmount ?? "—"} ${purchase.currency}`
                      : `${purchase.tokenAmount ?? "—"} Cookie Run token`}
                  </span>
                </div>

                {error && (
                  <p
                    className="font-mono text-[11px] text-destructive mb-3"
                    data-testid="text-buy-pay-error"
                  >
                    {error}
                  </p>
                )}

                {step === "confirm_failed" ? (
                  <>
                    <p
                      className="font-mono text-[11px] text-muted-foreground mb-3"
                      data-testid="text-buy-confirm-failed"
                    >
                      Your payment was sent but confirmation didn't finish. Your
                      funds are safe — retry below and we won't charge you again.
                    </p>
                    <button
                      onClick={pay}
                      data-testid="button-buy-retry-confirm"
                      className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full flex items-center justify-center gap-2"
                    >
                      Retry Confirmation
                    </button>
                  </>
                ) : (
                  <button
                    onClick={pay}
                    disabled={step === "paying" || step === "confirming"}
                    data-testid="button-buy-pay"
                    className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {step === "paying" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Approve in wallet…
                      </>
                    ) : step === "confirming" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Confirming payment…
                      </>
                    ) : purchase.currency === "TOKEN" ? (
                      `Pay ${purchase.tokenAmount ?? ""} Cookie Run token`
                     ) : (
                       `Pay ${purchase.solAmount ?? ""} ${purchase.currency}`
                    )}
                  </button>
                )}
                <p className="mt-3 font-mono text-[10px] text-muted-foreground/50 text-center tracking-wider">
                   {purchase.currency} quote · settled on Cookie Chain
                </p>
              </>
            )
          )}
        </>
      )}
    </Modal>
  );
}
