import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  useGetBenchmarks,
  getGetBenchmarksQueryKey,
  useGetGpuCatalog,
  getGetGpuCatalogQueryKey,
  type BenchmarkEntry,
} from "@workspace/api-client-react";
import { useIcpx } from "@/lib/icpx";
import { AppShell } from "@/components/AppShell";
import {
  ArrowLeft,
  Activity,
  Gauge,
  Zap,
  HardDrive,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";

type MetricKey =
  | "llmTokensPerSec"
  | "trainingScore"
  | "fp16Tflops"
  | "memBandwidthGbs";

const METRICS: {
  key: MetricKey;
  label: string;
  unit: string;
  Icon: typeof Activity;
}[] = [
  { key: "llmTokensPerSec", label: "LLM tok/s", unit: "tok/s", Icon: Activity },
  { key: "trainingScore", label: "Training", unit: "", Icon: Gauge },
  { key: "fp16Tflops", label: "FP16", unit: "TFLOPS", Icon: Zap },
  { key: "memBandwidthGbs", label: "Bandwidth", unit: "GB/s", Icon: HardDrive },
];

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function fmtUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}
function fmtNum(n: number): string {
  return n >= 1000 ? n.toLocaleString() : String(n);
}
function slug(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

export default function Benchmarks() {
  const { openRentWith } = useIcpx();
  const { data, isLoading, isError } = useGetBenchmarks({
    query: { queryKey: getGetBenchmarksQueryKey() },
  });
  const { data: catalog } = useGetGpuCatalog({
    query: {
      refetchInterval: 60_000,
      staleTime: 30_000,
      queryKey: getGetGpuCatalogQueryKey(),
    },
  });

  const [metric, setMetric] = useState<MetricKey>("llmTokensPerSec");

  const benchmarks = useMemo(() => {
    const list = data?.benchmarks ?? [];
    return [...list].sort((a, b) => b[metric] - a[metric]);
  }, [data, metric]);

  const maxVal = useMemo(
    () => benchmarks.reduce((m, b) => Math.max(m, b[metric]), 0) || 1,
    [benchmarks, metric],
  );

  const priceByModel = useMemo(() => {
    const map = new Map<string, number>();
    const cat = catalog?.gpus ?? [];
    for (const b of data?.benchmarks ?? []) {
      const bk = normKey(b.model);
      const hit = cat.find((g) => {
        const gk = normKey(g.model);
        return (
          gk === bk ||
          (gk.length >= 4 && bk.length >= 4 && (gk.includes(bk) || bk.includes(gk)))
        );
      });
      if (hit) map.set(b.model, hit.fromUsdHr);
    }
    return map;
  }, [catalog, data]);

  const activeMetric = METRICS.find((m) => m.key === metric)!;

  return (
    <AppShell>
      <div className="max-w-[1400px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Title */}
        <div className="mb-8 md:mb-12 max-w-2xl">
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-2">GPU comparison</div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            GPU <span className="text-primary">Benchmarks</span>
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Compare GPUs across inference, training, and memory throughput. Pick a
            metric to rank the field, then rent the right card in one click.
            Figures are indicative, for relative comparison.
          </p>
        </div>

        {/* Metric selector */}
        <div
          className="flex flex-wrap gap-2 mb-8 relative p-1 bg-card border border-border rounded-xl w-fit"
          data-testid="metric-selector"
        >
          {METRICS.map((m) => {
            const active = m.key === metric;
            return (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                data-testid={`button-metric-${m.key}`}
                className={cn(
                  "text-sm font-semibold tracking-wide px-5 py-2.5 flex items-center gap-2 relative z-10 transition-colors rounded-lg",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <motion.div
                    layoutId="metric-indicator"
                    className="absolute inset-0 bg-secondary rounded-lg -z-10 shadow-sm"
                  />
                )}
                <m.Icon className="h-4 w-4" /> 
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* States */}
        {isLoading ? (
          <div className="bg-card border border-border rounded-xl p-14 flex items-center justify-center min-h-[40vh]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-destructive/30 rounded-xl p-10 sm:p-14 max-w-2xl" data-testid="state-error">
            <AlertTriangle className="h-8 w-8 text-destructive mb-5" />
            <h2 className="font-bold text-3xl tracking-tight mb-3">Benchmarks unavailable</h2>
            <p className="text-base text-muted-foreground leading-relaxed">
              We couldn't load the benchmark catalog. Try again in a moment.
            </p>
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} initial="hidden" animate="show" className="flex flex-col gap-4" data-testid="list-benchmarks">
            {benchmarks.map((entry, idx) => {
              const value = entry[metric];
              const pct = Math.max(2, Math.round((value / maxVal) * 100));
              const price = priceByModel.get(entry.model);
              return (
                <motion.div
                  key={entry.model}
                  variants={itemVariants}
                  className="bg-card border border-border rounded-xl p-6 sm:p-8 group hover:border-primary/50 transition-colors shadow-sm"
                  data-testid={`row-benchmark-${slug(entry.model)}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-4 min-w-0">
                      <span
                        className={`text-xl font-bold tabular-nums w-8 shrink-0 ${
                          idx < 3 ? "text-primary" : "text-muted-foreground/40"
                        }`}
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <h3 className="font-bold text-2xl tracking-tight truncate">
                        {entry.model}
                      </h3>
                      <span
                        className="text-xs font-bold px-2 py-1 text-primary tracking-wider ml-2 rounded-md bg-primary/10"
                      >
                        {entry.vramGb}GB
                      </span>
                    </div>
                    <button
                      onClick={() => openRentWith({ model: entry.model })}
                      data-testid={`button-rent-${slug(entry.model)}`}
                      className="h-10 px-5 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-semibold flex items-center justify-center gap-2 shrink-0 transition-colors"
                    >
                      Rent <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Metric bar */}
                  <div className="flex items-center gap-6">
                    <div className="flex-1 h-3 relative bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ type: "spring" as const, stiffness: 100, damping: 20 }}
                        className="h-full bg-primary"
                      />
                    </div>
                    <span className="text-xl font-bold tabular-nums text-foreground w-32 text-right shrink-0">
                      {fmtNum(value)}
                      {activeMetric.unit ? (
                        <span className="text-xs font-semibold text-muted-foreground ml-1.5 uppercase">
                          {activeMetric.unit}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  {/* Secondary metrics */}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-6 text-sm font-medium text-muted-foreground border-t border-border pt-6">
                    <span>{fmtNum(entry.llmTokensPerSec)} tok/s</span>
                    <span className="hidden sm:inline text-border">|</span>
                    <span>{fmtNum(entry.fp16Tflops)} FP16 TFLOPS</span>
                    <span className="hidden sm:inline text-border">|</span>
                    <span>{fmtNum(entry.memBandwidthGbs)} GB/s</span>
                    <span className="hidden sm:inline text-border">|</span>
                    <span>Train {entry.trainingScore}</span>
                    {price != null && (
                      <>
                        <span className="hidden sm:inline text-border">|</span>
                        <span className="text-primary font-bold">
                          live from {fmtUsd(price)}/hr
                        </span>
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        <p className="text-xs font-medium text-muted-foreground/70 mt-12 leading-relaxed max-w-2xl border-t border-border pt-6">
          Training score is relative to {data?.baseline ?? "the top card"} (= 100).
          LLM throughput reflects single-stream Llama-3 8B inference. Numbers are
          indicative and vary with batch size, precision, and software stack.
        </p>
      </div>
    </AppShell>
  );
}
