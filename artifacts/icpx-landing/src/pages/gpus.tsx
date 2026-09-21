import { useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  useGetGpuCatalog,
  getGetGpuCatalogQueryKey,
  type GpuCatalogEntry,
} from "@workspace/api-client-react";
import { useIcpx } from "@/lib/icpx";
import { AppShell } from "@/components/AppShell";
import {
  Cpu,
  Search,
  MapPin,
  ChevronRight,
  Loader2,
  RefreshCw,
  Server,
  AlertTriangle,
} from "lucide-react";

type SortKey = "price" | "vram" | "available";

const VRAM_OPTIONS: { label: string; value: number }[] = [
  { label: "Any VRAM", value: 0 },
  { label: "≥ 8 GB", value: 8 },
  { label: "≥ 16 GB", value: 16 },
  { label: "≥ 24 GB", value: 24 },
  { label: "≥ 48 GB", value: 48 },
  { label: "≥ 80 GB", value: 80 },
];

const SORTS: { label: string; value: SortKey }[] = [
  { label: "Cheapest", value: "price" },
  { label: "Most VRAM", value: "vram" },
  { label: "Most available", value: "available" },
];

function fmtUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}
function fmtEth(n: number): string {
  return n.toFixed(n < 0.01 ? 6 : 4);
}
function slug(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const SELECT_CLASS =
  "bg-transparent text-foreground text-[12px] font-mono font-bold uppercase tracking-wider px-4 py-3 outline-none cursor-pointer appearance-none focus:bg-secondary border-none";

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

function GpuCard({
  entry,
  onRent,
}: {
  entry: GpuCatalogEntry;
  onRent: () => void;
}) {
  const id = slug(entry.model);
  return (
    <div
      className="bg-background border border-border p-6 flex flex-col h-full hover:border-foreground transition-colors"
      data-testid={`card-gpu-${id}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-[10px] font-mono font-bold tracking-widest text-muted-foreground uppercase mb-1">NVIDIA</div>
          <h3
            className="font-sans font-bold text-2xl tracking-tight leading-none break-words uppercase"
            data-testid={`text-gpu-model-${id}`}
          >
            {entry.model}
          </h3>
        </div>
        {entry.gpuRamGb != null && (
          <span
            className="text-[11px] font-mono font-bold px-2 py-1 text-foreground shrink-0 border border-border bg-secondary"
          >
            {entry.gpuRamGb}GB
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 text-[12px] font-mono font-semibold text-muted-foreground mb-5 uppercase tracking-wider">
        <span className="flex items-center gap-1.5">
          <Server className="h-3 w-3" /> {entry.available} host{entry.available === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3" /> {entry.totalGpus} unit{entry.totalGpus === 1 ? "" : "s"}
        </span>
      </div>

      {entry.regions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-6">
          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
          {entry.regions.slice(0, 6).map((r) => (
            <span
              key={r}
              className="text-[10px] font-mono font-bold text-foreground px-1.5 py-0.5 bg-secondary border border-border uppercase"
            >
              {r}
            </span>
          ))}
          {entry.regions.length > 6 && (
            <span className="text-[10px] font-mono font-bold text-muted-foreground">
              +{entry.regions.length - 6}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto border-t border-border pt-5">
        <div className="text-[10px] font-mono font-bold tracking-widest text-muted-foreground uppercase mb-1">From</div>
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-mono font-bold text-3xl text-foreground tabular-nums tracking-tight"
            data-testid={`text-gpu-price-${id}`}
          >
            {fmtUsd(entry.fromUsdHr)}
          </span>
          <span className="text-[12px] font-mono font-bold text-muted-foreground uppercase">/hr</span>
        </div>
        <div className="text-[11px] font-mono font-bold text-muted-foreground mt-1 tabular-nums uppercase tracking-wider">
          ≈ {fmtEth(entry.fromEthHr)} ETH/HR
        </div>
        <div
          className="text-[11px] font-sans font-medium text-muted-foreground mt-1.5"
          data-testid={`text-gpu-min-${id}`}
        >
          Exact quote prior to payment
        </div>

        <button
          onClick={onRent}
          data-testid={`button-rent-${id}`}
          className="w-full mt-6 bg-foreground text-background hover:bg-background hover:text-foreground border border-foreground h-11 text-[13px] font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors"
        >
          Rent <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function Gpus() {
  const { openRentWith } = useIcpx();
  const { data, isLoading, isError, refetch, isFetching } = useGetGpuCatalog({
    query: {
      refetchInterval: 60_000,
      staleTime: 30_000,
      queryKey: getGetGpuCatalogQueryKey(),
    },
  });

  const [search, setSearch] = useState("");
  const [minVram, setMinVram] = useState(0);
  const [region, setRegion] = useState("all");
  const [sort, setSort] = useState<SortKey>("price");

  const regions = data?.regions ?? [];

  const filtered = useMemo(() => {
    const gpus = data?.gpus ?? [];
    const q = search.trim().toLowerCase();
    const out = gpus.filter((g) => {
      if (q && !g.model.toLowerCase().includes(q)) return false;
      if (minVram && (g.gpuRamGb ?? 0) < minVram) return false;
      if (region !== "all" && !g.regions.includes(region)) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "price") return a.fromUsdHr - b.fromUsdHr;
      if (sort === "vram") return (b.gpuRamGb ?? 0) - (a.gpuRamGb ?? 0);
      return b.available - a.available;
    });
    return out;
  }, [data, search, minVram, region, sort]);

  return (
    <AppShell>
      <div className="max-w-[1400px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Title */}
        <div className="mb-8 md:mb-12 max-w-2xl">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-4 uppercase">
            GPU Explorer
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Real-time availability and pricing across the network. Rates update
             live and are quoted per GPU-hour in COOK on Cookie Chain.
            Availability is verified on demand. Provision a system instantly.
          </p>
        </div>

        {/* Filters */}
        <div
          className="bg-background border border-border flex flex-col lg:flex-row lg:items-center gap-0 mb-8"
          data-testid="panel-filters"
        >
          <div className="relative flex-1 min-w-0 flex items-center border-b lg:border-b-0 lg:border-r border-border">
            <Search className="h-4 w-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SEARCH HARDWARE..."
              data-testid="input-search-gpu"
              className="w-full bg-transparent text-[12px] font-mono font-bold placeholder:text-muted-foreground pl-11 pr-4 py-4 outline-none uppercase tracking-wider"
            />
          </div>
          <div className="flex flex-col sm:flex-row w-full lg:w-auto">
            <select
              value={minVram}
              onChange={(e) => setMinVram(Number(e.target.value))}
              data-testid="select-vram"
              className={`${SELECT_CLASS} border-b sm:border-b-0 sm:border-r border-border py-4 flex-1`}
            >
              {VRAM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-background">
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              data-testid="select-region"
              className={`${SELECT_CLASS} border-b sm:border-b-0 sm:border-r border-border py-4 flex-1`}
            >
              <option value="all" className="bg-background">ALL REGIONS</option>
              {regions.map((r) => (
                <option key={r} value={r} className="bg-background">
                  {r}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              data-testid="select-sort"
              className={`${SELECT_CLASS} py-4 flex-1`}
            >
              {SORTS.map((o) => (
                <option key={o.value} value={o.value} className="bg-background">
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center justify-between mb-8 gap-3 border-b border-border pb-4">
          <div
            className="text-[12px] font-mono font-bold tracking-widest text-muted-foreground flex items-center gap-3 uppercase"
            data-testid="text-result-count"
          >
            {isLoading ? (
              <span className="text-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> SYNCHRONIZING NETWORK
              </span>
            ) : (
              <span>
                <span className="text-foreground">{filtered.length}</span> SYSTEM{filtered.length === 1 ? "" : "S"} DETECTED
              </span>
            )}
            {data && <span className="text-border">|</span>}
            {data && <span>ETH ${data.ethUsd.toFixed(2)}</span>}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
            className="h-8 px-4 border border-border bg-secondary text-foreground hover:bg-foreground hover:text-background hover:border-foreground text-[11px] font-mono font-bold uppercase tracking-wider flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`h-3 w-3 ${isFetching ? "animate-spin text-background" : ""}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* States */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-background border border-border p-6 h-[24rem] flex items-center justify-center"
              >
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-background border border-foreground p-10 sm:p-14 max-w-2xl flex flex-col items-start gap-5"
            data-testid="state-error"
          >
            <AlertTriangle className="h-8 w-8 text-foreground" />
            <div>
              <h2 className="font-bold text-3xl tracking-tight mb-2 uppercase">Network Connection Failed</h2>
              <p className="text-base text-muted-foreground leading-relaxed max-w-md">
                We couldn't reach the GPU provider. The platform interface might be undergoing maintenance.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              data-testid="button-retry"
              className="bg-foreground text-background hover:bg-background hover:text-foreground border border-foreground h-11 px-6 font-mono font-bold uppercase tracking-widest flex items-center gap-2 mt-2 transition-colors"
            >
              <RefreshCw className="h-4 w-4" /> Initialize Retry
            </button>
          </motion.div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-background border border-border p-10 sm:p-14 max-w-2xl"
            data-testid="state-empty"
          >
            <h2 className="font-bold text-3xl tracking-tight mb-2 uppercase">Zero Parameters Matched</h2>
            <p className="text-base text-muted-foreground leading-relaxed max-w-md mb-6">
              Your filter configuration isolated zero active systems in the network.
            </p>
            <button
              onClick={() => {
                setSearch("");
                setMinVram(0);
                setRegion("all");
              }}
              data-testid="button-clear-filters"
              className="border border-border bg-secondary text-foreground hover:bg-foreground hover:text-background h-11 px-6 font-mono font-bold uppercase tracking-widest transition-colors"
            >
              Reset Parameters
            </button>
          </motion.div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filtered.map((entry) => (
              <motion.div key={entry.model} variants={itemVariants}>
                <GpuCard
                  entry={entry}
                  onRent={() => openRentWith({ model: entry.model })}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}