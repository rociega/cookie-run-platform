import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  useBrowseListings,
  useGetMyListings,
  useGetMyPurchases,
  getPurchaseDownload,
  deleteListing,
  createReview,
  getGetMyListingsQueryKey,
  getGetMyPurchasesQueryKey,
  getBrowseListingsQueryKey,
  type ListingPublic,
  type Listing,
  type Purchase,
  type BrowseListingsParams,
  type BrowseListingsCategory,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Search,
  Loader2,
  AlertTriangle,
  Store,
  Tag,
  Download,
  Cpu,
  Boxes,
  Database,
  Layers,
  ShoppingBag,
  Plus,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  Star,
} from "lucide-react";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { AppShell } from "@/components/AppShell";
import BuyModal from "@/components/BuyModal";
import SellModal from "@/components/SellModal";
import { StarRating, StarInput } from "@/components/Stars";
import { useRewardsAuth } from "@/lib/rewardsAuth";
import { useIcpx } from "@/lib/icpx";
import { describePayError } from "@/lib/solanaPay";

type Tab = "browse" | "listings" | "purchases";

const CATEGORY_LABEL: Record<string, string> = {
  model: "Model / LoRA",
  dataset: "Dataset",
  template: "Template",
};

const CATEGORY_ICON: Record<string, typeof Boxes> = {
  model: Boxes,
  dataset: Database,
  template: Layers,
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
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

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 400, damping: 30 } }
};

function CategoryBadge({ category }: { category: string }) {
  const Icon = CATEGORY_ICON[category] ?? Tag;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] uppercase text-primary">
      <Icon className="h-3 w-3" />
      {CATEGORY_LABEL[category] ?? category}
    </span>
  );
}

function BrowseCard({
  listing,
  onBuy,
}: {
  listing: ListingPublic;
  onBuy: (l: ListingPublic) => void;
}) {
  const size = formatBytes(listing.fileSizeBytes);
  return (
    <div
      className="bg-card border border-border rounded-xl p-6 flex flex-col h-full hover:border-primary/50 transition-colors shadow-sm"
      data-testid={`card-listing-${listing.id}`}
    >
      <CategoryBadge category={listing.category} />
      <h3 className="font-bold text-2xl tracking-tight leading-none mt-4">
        {listing.title}
      </h3>
      {listing.description && (
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed line-clamp-3 flex-1">
          {listing.description}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 pb-4 border-b border-border">
        <span className="truncate">
          by {listing.sellerHandle || listing.sellerWallet}
        </span>
        {size && <span className="shrink-0">{size}</span>}
      </div>
      <div className="flex items-center justify-between mt-4">
        <div>
          <div className="font-bold text-3xl text-foreground tabular-nums tracking-tight leading-none">
            ${listing.priceUsd}
          </div>
          {listing.avgRating != null && (listing.reviewCount ?? 0) > 0 ? (
            <div
              className="flex items-center gap-2 mt-2"
              data-testid={`rating-listing-${listing.id}`}
            >
              <StarRating value={listing.avgRating} size={14} />
              <span className="text-xs font-medium text-muted-foreground/60 tabular-nums">
                {listing.avgRating.toFixed(1)} ({listing.reviewCount})
              </span>
            </div>
          ) : (
            <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mt-2">
              No reviews yet
            </div>
          )}
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mt-1">
            {listing.salesCount} sold
          </div>
        </div>
        <button
          onClick={() => onBuy(listing)}
          data-testid={`button-buy-${listing.id}`}
          className="h-11 px-6 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold flex items-center gap-2 transition-colors"
        >
          <ShoppingBag className="h-4 w-4" /> Buy
        </button>
      </div>
    </div>
  );
}

function ListingCard({
  listing,
  onEdit,
  onRemove,
  removing,
}: {
  listing: Listing;
  onEdit: (l: Listing) => void;
  onRemove: (l: Listing) => void;
  removing: boolean;
}) {
  const size = formatBytes(listing.fileSizeBytes);
  const statusStyle =
    listing.status === "active"
      ? "text-live border-live/30 bg-live/10"
      : "text-muted-foreground border-border bg-secondary/30";
  const removed = listing.status === "removed";
  return (
    <div
      className="bg-card border border-border rounded-xl p-6 flex flex-col h-full shadow-sm"
      data-testid={`card-my-listing-${listing.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CategoryBadge category={listing.category} />
          <h3 className="font-bold text-2xl tracking-tight leading-none mt-3 truncate">
            {listing.title}
          </h3>
        </div>
        <span
          className={cn(
            "text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 shrink-0 border rounded-md",
            statusStyle
          )}
        >
          {listing.status}
        </span>
      </div>
      <div className="flex items-center gap-6 mt-5 text-xs font-semibold uppercase tracking-wider pb-4 border-b border-border">
        <div>
          <span className="text-muted-foreground">Price </span>
          <span className="font-bold text-foreground">${listing.priceUsd}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Sales </span>
          <span className="font-bold text-foreground">{listing.salesCount}</span>
        </div>
        {size && (
          <div className="text-muted-foreground/70 truncate">{size}</div>
        )}
      </div>
      {listing.fileName && (
        <div className="text-xs font-medium text-muted-foreground/60 mt-4 truncate">
          {listing.fileName}
        </div>
      )}
      {!removed && (
        <div
          className="flex items-center gap-3 mt-5 pt-1"
        >
          <button
            onClick={() => onEdit(listing)}
            disabled={removing}
            data-testid={`button-edit-listing-${listing.id}`}
            className="h-9 px-4 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Pencil className="h-4 w-4" /> Edit
          </button>
          <button
            onClick={() => onRemove(listing)}
            disabled={removing}
            data-testid={`button-remove-listing-${listing.id}`}
            className="h-9 px-4 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewForm({
  purchase,
  onSubmitted,
}: {
  purchase: Purchase;
  onSubmitted: () => void;
}) {
  const existing = purchase.myReview ?? null;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [editing, setEditing] = useState(!existing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating < 1 || rating > 5) {
      setError("Pick a star rating from 1 to 5.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createReview(purchase.listingId, { rating, body: body.trim() || undefined });
      setEditing(false);
      onSubmitted();
    } catch (e) {
      setError(describePayError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (existing && !editing) {
    return (
      <div
        className="mt-5 pt-5"
        style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
        data-testid={`review-summary-${purchase.id}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="mono-label">
              Your review
            </span>
            <StarRating value={existing.rating} size={13} />
          </div>
        </div>
        {existing.body && (
          <p className="font-mono text-[11px] text-muted-foreground/80 mt-3 leading-relaxed">
            {existing.body}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-5 pt-5"
      style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
      data-testid={`review-form-${purchase.id}`}
    >
      <div className="mono-label mb-3">
        Rate this asset
      </div>
      <StarInput value={rating} onChange={setRating} disabled={submitting} />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Share what worked (optional)…"
        data-testid={`input-review-body-${purchase.id}`}
        className="w-full bg-transparent font-mono text-[12px] mt-4 p-3 outline-none resize-none placeholder:text-muted-foreground/40"
        style={{ border: "1px solid rgba(255,255,255,0.15)" }}
      />
      {error && (
        <p className="font-mono text-[11px] text-red-400 mt-2">{error}</p>
      )}
      <button
        onClick={() => void submit()}
        disabled={submitting}
        data-testid={`button-submit-review-${purchase.id}`}
        className="premium-btn font-mono font-bold text-[11px] tracking-widest uppercase px-5 py-3 mt-4 flex items-center gap-2 disabled:opacity-50"
      >
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
        {submitting ? "Submitting…" : "Submit review"}
      </button>
    </div>
  );
}

function PurchaseCard({
  purchase,
  onDownload,
  downloading,
  onLaunch,
  onReviewed,
}: {
  purchase: Purchase;
  onDownload: (p: Purchase) => void;
  downloading: boolean;
  onLaunch: (templateId: string) => void;
  onReviewed: () => void;
}) {
  const paid = purchase.paymentStatus === "paid";
  return (
    <div
      className="bg-card border border-border rounded-xl p-6 flex flex-col h-full shadow-sm"
      data-testid={`card-purchase-${purchase.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CategoryBadge category={purchase.category} />
          <h3 className="font-bold text-2xl tracking-tight leading-none mt-3 truncate">
            {purchase.listingTitle}
          </h3>
          <div className="text-xs font-semibold tracking-wider uppercase text-muted-foreground/60 mt-3">
            {fmtDate(purchase.createdAt)} ·{" "}
            <span className="text-foreground font-bold">
              {purchase.currency === "ICPX"
                ? `${purchase.tokenAmount ?? "—"} ICPX`
                : purchase.currency === "COOK"
                  ? `${purchase.solAmount ?? "—"} COOK`
                : purchase.currency === "ETH"
                  ? `${purchase.ethAmount ?? "—"} ETH · legacy`
                  : `${purchase.solAmount} SOL · legacy`}
            </span>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 shrink-0 border rounded-md",
            paid
              ? "text-live border-live/30 bg-live/10"
              : "text-yellow-500 border-yellow-500/30 bg-yellow-500/10"
          )}
        >
          {paid ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Paid
            </>
          ) : (
            <>
              <Clock className="h-4 w-4" /> Pending
            </>
          )}
        </span>
      </div>

      {paid ? (
        <div className="flex flex-wrap gap-3 mt-6 pt-5 border-t border-border">
          <button
            onClick={() => onDownload(purchase)}
            disabled={downloading}
            data-testid={`button-download-${purchase.id}`}
            className="h-9 px-4 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? "Preparing…" : "Download"}
          </button>
          {purchase.category === "template" && purchase.suggestedTemplateId && (
            <button
              onClick={() => onLaunch(purchase.suggestedTemplateId!)}
              data-testid={`button-launch-${purchase.id}`}
              className="h-9 px-4 rounded-md border border-border bg-transparent hover:bg-secondary/50 text-sm font-semibold flex items-center gap-2 transition-colors"
            >
              <Cpu className="h-4 w-4" /> Launch in workspace
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/70 mt-6 pt-5 border-t border-border leading-relaxed">
          Payment not confirmed yet. If you already approved it in your wallet,
          it may still be settling — check back shortly. Otherwise you can buy it
          again from Browse.
        </p>
      )}

      {paid && <ReviewForm purchase={purchase} onSubmitted={onReviewed} />}
    </div>
  );
}

export default function Marketplace() {
  const {
    isAuthed,
    connected,
    canSign,
    signingIn,
    signIn,
    signOut,
    error: authError,
    invalidateSession,
    walletAddress,
  } = useRewardsAuth();
  const { openRentWith } = useIcpx();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("browse");
  const [category, setCategory] = useState<BrowseListingsCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [buyTarget, setBuyTarget] = useState<ListingPublic | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Listing | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Honor deep links like /marketplace?tab=purchases from the buy/sell modals.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "listings" || t === "purchases") setTab(t as Tab);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const browseParams = useMemo<BrowseListingsParams>(() => {
    const p: BrowseListingsParams = {};
    if (category !== "all") p.category = category;
    if (debouncedSearch) p.q = debouncedSearch;
    return p;
  }, [category, debouncedSearch]);

  const browseQ = useBrowseListings(browseParams);
  const myListingsQ = useGetMyListings({
    query: {
      enabled: isAuthed && tab === "listings",
      queryKey: [...getGetMyListingsQueryKey(), walletAddress ?? "anonymous"],
    },
  });
  const myPurchasesQ = useGetMyPurchases({
    query: {
      enabled: isAuthed && tab === "purchases",
      queryKey: [...getGetMyPurchasesQueryKey(), walletAddress ?? "anonymous"],
    },
  });

  // A stale bearer token surfaces as 401 on the authed tabs — drop the session.
  useEffect(() => {
    const err = (myListingsQ.error ?? myPurchasesQ.error) as
      | { status?: number }
      | undefined;
    if (isAuthed && err?.status === 401) invalidateSession();
  }, [myListingsQ.error, myPurchasesQ.error, isAuthed, invalidateSession]);

  function refetchMine() {
    void queryClient.invalidateQueries({
      queryKey: [...getGetMyListingsQueryKey(), walletAddress ?? "anonymous"],
    });
    void queryClient.invalidateQueries({
      queryKey: [...getGetMyPurchasesQueryKey(), walletAddress ?? "anonymous"],
    });
    void queryClient.invalidateQueries({ queryKey: getBrowseListingsQueryKey() });
  }

  async function handleRemove(l: Listing) {
    if (
      !window.confirm(
        `Remove "${l.title}"? It will no longer appear in Browse. Buyers who already purchased it keep their downloads.`,
      )
    ) {
      return;
    }
    setRemovingId(l.id);
    setListingError(null);
    try {
      await deleteListing(l.id);
      refetchMine();
    } catch (e) {
      if ((e as { status?: number })?.status === 401) invalidateSession();
      setListingError(describePayError(e));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDownload(p: Purchase) {
    setDownloadingId(p.id);
    setDownloadError(null);
    try {
      const grant = await getPurchaseDownload(p.id);
      window.open(grant.downloadURL, "_blank", "noopener,noreferrer");
    } catch (e) {
      if ((e as { status?: number })?.status === 401) invalidateSession();
      setDownloadError(describePayError(e));
    } finally {
      setDownloadingId(null);
    }
  }

  function handleLaunch(templateId: string) {
    openRentWith({ templateId });
  }

  const listings = browseQ.data ?? [];
  const myListings = myListingsQ.data ?? [];
  const myPurchases = myPurchasesQ.data ?? [];

  const TABS: { id: Tab; label: string; authed: boolean }[] = [
    { id: "browse", label: "Browse", authed: false },
    { id: "listings", label: "My Listings", authed: true },
    { id: "purchases", label: "My Purchases", authed: true },
  ];

  const CATEGORY_FILTERS: { id: BrowseListingsCategory | "all"; label: string }[] =
    [
      { id: "all", label: "All" },
      { id: "model" as BrowseListingsCategory, label: "Models / LoRAs" },
      { id: "dataset" as BrowseListingsCategory, label: "Datasets" },
      { id: "template" as BrowseListingsCategory, label: "Templates" },
    ];

  return (
    <AppShell>
      <div className="max-w-[1400px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Title */}
        <div className="mb-8 md:mb-12 max-w-2xl">
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-2">Creator marketplace</div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Asset <span className="text-primary">Market</span>
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Buy and sell AI models, datasets, and ready-to-run templates. Pay in
             COOK on Cookie Chain — sellers earn Cookie Run points on every sale, and template
            buyers can launch straight into a Cookie Run workspace.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-10 overflow-x-auto border-b border-border pb-px relative">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`tab-${t.id}`}
                className={cn(
                  "text-sm font-semibold tracking-wide uppercase px-6 py-4 whitespace-nowrap transition-colors relative z-10",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {active && (
                  <motion.div
                    layoutId="marketplace-tab"
                    className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* BROWSE */}
        {tab === "browse" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <div
                className="flex items-center gap-3 px-4 flex-1 bg-card border border-border rounded-xl p-2 shadow-sm"
              >
                <Search className="h-5 w-5 text-muted-foreground shrink-0 ml-2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models, datasets, templates…"
                  data-testid="input-search"
                  className="w-full bg-transparent text-sm font-medium py-3 outline-none placeholder:text-muted-foreground/50"
                />
              </div>
              <div className="flex items-center gap-2 overflow-x-auto bg-card border border-border rounded-xl p-2 shadow-sm">
                {CATEGORY_FILTERS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    data-testid={`filter-${c.id}`}
                    className={cn(
                      "text-sm font-semibold tracking-wide px-5 py-3 whitespace-nowrap transition-colors rounded-lg",
                      category === c.id ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground bg-transparent"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {browseQ.isLoading ? (
              <LoadingRow label="Loading marketplace…" />
            ) : browseQ.isError ? (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-destructive/30 rounded-xl p-10 sm:p-14 max-w-2xl">
                <AlertTriangle className="h-8 w-8 text-destructive mb-5" />
                <h2 className="font-bold text-3xl tracking-tight mb-3">
                  Couldn't load listings
                </h2>
                <p className="text-base text-muted-foreground mb-6 leading-relaxed">
                  Something went wrong fetching the marketplace. Please try again.
                </p>
                <button
                  onClick={() => void browseQ.refetch()}
                  data-testid="button-retry-browse"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6 rounded-full font-semibold flex items-center justify-center transition-colors"
                >
                  Retry
                </button>
              </motion.div>
            ) : listings.length === 0 ? (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-xl p-10 sm:p-14 max-w-2xl" data-testid="empty-browse">
                <Store className="h-8 w-8 text-primary/50 mb-5" />
                <h2 className="font-bold text-3xl tracking-tight mb-3">
                  Nothing here yet
                </h2>
                <p className="text-base text-muted-foreground leading-relaxed mb-8">
                  {debouncedSearch || category !== "all"
                    ? "No listings match your filters. Try a broader search."
                    : "Be the first to list an asset. Sell a model, dataset, or template and earn Cookie Run points on every sale."}
                </p>
                <button
                  onClick={() => setSellOpen(true)}
                  data-testid="button-empty-sell"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6 rounded-full font-semibold inline-flex items-center gap-2 transition-colors"
                >
                  <Plus className="h-4 w-4" /> List an asset
                </button>
              </motion.div>
            ) : (
              <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((l) => (
                  <motion.div key={l.id} variants={itemVariants}>
                    <BrowseCard listing={l} onBuy={setBuyTarget} />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* MY LISTINGS */}
        {tab === "listings" &&
          (!isAuthed ? (
            <AuthGate
              connected={connected}
              canSign={canSign}
              signingIn={signingIn}
              signIn={signIn}
              error={authError}
              verb="manage your listings"
            />
          ) : myListingsQ.isLoading ? (
            <LoadingRow label="Loading your listings…" />
          ) : myListings.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-10 sm:p-14 max-w-2xl" data-testid="empty-listings">
              <Tag className="h-8 w-8 text-primary/50 mb-5" />
              <h2 className="font-bold text-3xl tracking-tighter uppercase display-tight mb-3">
                No listings yet
              </h2>
              <p className="font-mono text-[13px] text-muted-foreground leading-relaxed mb-8">
                List your first asset to start earning Cookie Run points on every sale.
              </p>
              <button
                onClick={() => setSellOpen(true)}
                data-testid="button-listings-sell"
                className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4" /> Sell an asset
              </button>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {listingError && (
                <p
                  className="font-mono text-[11px] text-red-400 mb-5 border border-red-400/20 bg-red-400/10 p-4 rounded-sm"
                  data-testid="text-listing-error"
                >
                  {listingError}
                </p>
              )}
              <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid gap-5 md:grid-cols-2">
                {myListings.map((l) => (
                  <motion.div key={l.id} variants={itemVariants}>
                    <ListingCard
                      listing={l}
                      onEdit={setEditTarget}
                      onRemove={handleRemove}
                      removing={removingId === l.id}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          ))}

        {/* MY PURCHASES */}
        {tab === "purchases" &&
          (!isAuthed ? (
            <AuthGate
              connected={connected}
              canSign={canSign}
              signingIn={signingIn}
              signIn={signIn}
              error={authError}
              verb="view your purchases"
            />
          ) : myPurchasesQ.isLoading ? (
            <LoadingRow label="Loading your purchases…" />
          ) : myPurchases.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-10 sm:p-14 max-w-2xl" data-testid="empty-purchases">
              <ShoppingBag className="h-8 w-8 text-primary/50 mb-5" />
              <h2 className="font-bold text-3xl tracking-tighter uppercase display-tight mb-3">
                No purchases yet
              </h2>
              <p className="font-mono text-[13px] text-muted-foreground leading-relaxed mb-8">
                Assets you buy show up here with private, re-downloadable links.
              </p>
              <button
                onClick={() => setTab("browse")}
                data-testid="button-purchases-browse"
                className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 inline-flex items-center gap-2"
              >
                <Store className="h-4 w-4" /> Browse marketplace
              </button>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {downloadError && (
                <p
                  className="font-mono text-[11px] text-red-400 mb-5 border border-red-400/20 bg-red-400/10 p-4 rounded-sm"
                  data-testid="text-download-error"
                >
                  {downloadError}
                </p>
              )}
              <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid gap-5 md:grid-cols-2">
                {myPurchases.map((p) => (
                  <motion.div key={p.id} variants={itemVariants}>
                    <PurchaseCard
                      purchase={p}
                      onDownload={handleDownload}
                      downloading={downloadingId === p.id}
                      onLaunch={handleLaunch}
                      onReviewed={refetchMine}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          ))}
      </div>

      <BuyModal
        open={!!buyTarget}
        listing={buyTarget}
        onClose={() => setBuyTarget(null)}
        onPurchased={refetchMine}
      />
      <SellModal
        open={sellOpen || !!editTarget}
        editing={editTarget}
        onClose={() => {
          setSellOpen(false);
          setEditTarget(null);
        }}
        onCreated={refetchMine}
      />
    </AppShell>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[13px] tracking-widest uppercase text-muted-foreground py-12 px-6 glass-panel justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-primary" /> {label}
    </div>
  );
}

function AuthGate({
  connected,
  canSign,
  signingIn,
  signIn,
  error,
  verb,
}: {
  connected: boolean;
  canSign: boolean;
  signingIn: boolean;
  signIn: () => Promise<boolean>;
  error: string | null;
  verb: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-10 sm:p-14 max-w-2xl">
      <Store className="h-8 w-8 text-primary/50 mb-5" />
      <h2 className="font-bold text-3xl tracking-tighter uppercase display-tight mb-3">
        {connected ? "Sign in to continue" : "Connect your wallet"}
      </h2>
      <p className="font-mono text-[13px] text-muted-foreground leading-relaxed mb-8">
        {connected
          ? `Sign a free message to ${verb}. Everything is tied to the wallet you sign in with.`
          : `Connect your wallet to ${verb}.`}
      </p>
      {!connected ? (
        <ConnectWalletButton className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 inline-flex items-center gap-2" />
      ) : (
        <button
          onClick={() => void signIn()}
          disabled={!canSign || signingIn}
          data-testid="button-gate-sign-in"
          className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {signingIn ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {signingIn ? "Check your wallet…" : "Sign in with wallet"}
        </button>
      )}
      {connected && !canSign && (
        <p className="font-mono text-[11px] text-destructive mt-5 border border-destructive/20 bg-destructive/10 p-3 rounded-sm">
          This wallet can't sign messages. Try Phantom, Solflare, or Backpack.
        </p>
      )}
      {error && (
        <p className="font-mono text-[11px] text-destructive mt-5 border border-destructive/20 bg-destructive/10 p-3 rounded-sm">{error}</p>
      )}
    </motion.div>
  );
}
