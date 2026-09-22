import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";

const GPUS = [
  { model: "H100 SXM5", market: 4.20, prefund: 0.63 },
  { model: "H100 PCIe", market: 2.40, prefund: 0.34 },
  { model: "A100 80GB", market: 1.80, prefund: 0.27 },
  { model: "A100 40GB", market: 0.90, prefund: 0.14 },
];

export default function CostCalculator() {
  const [gpuIdx, setGpuIdx] = useState(1);
  const [hours, setHours] = useState(168);

  const gpu = GPUS[gpuIdx];
  const { marketTotal, prefundTotal, saved, savedPct } = useMemo(() => {
    const marketTotal = gpu.market * hours;
    const prefundTotal = gpu.prefund * hours;
    const saved = marketTotal - prefundTotal;
    const savedPct = Math.round((saved / marketTotal) * 100);
    return { marketTotal, prefundTotal, saved, savedPct };
  }, [gpu, hours]);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefundBarPct = Math.max(4, (prefundTotal / marketTotal) * 100);

  return (
    <div className="glass-panel bg-card overflow-hidden" data-testid="cost-calculator">
      <div className="flex items-center justify-between px-5 py-3 relative border-b border-white/10 bg-background/50">
        <span className="mono-label">Compute Cost Estimator</span>
        <span className="font-mono text-[10px] text-muted-foreground/60 tracking-widest">Indicative rates</span>
      </div>

      <div className="grid md:grid-cols-2 gap-0">
        {/* Controls */}
        <div className="p-8 lg:p-10 border-r-0 md:border-r border-white/10">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-4">Select GPU</div>
          <div className="grid grid-cols-2 gap-3 mb-10">
            {GPUS.map((g, i) => (
              <button key={g.model} data-testid={`button-calc-gpu-${i}`} onClick={() => setGpuIdx(i)}
                className={cn(
                  "font-mono text-[12px] font-bold py-3 px-2 tracking-wide transition-all text-center",
                  gpuIdx === i ? "premium-btn" : "premium-btn-ghost text-muted-foreground"
                )}>
                {g.model}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Duration</span>
            <span className="font-mono text-[16px] font-black text-primary tabular-nums">
              {hours}h <span className="text-muted-foreground/50 text-[12px] font-normal">({(hours / 24).toFixed(1)}d)</span>
            </span>
          </div>
          <input type="range" min={1} max={720} value={hours} data-testid="input-calc-hours"
            aria-label="Compute duration in hours"
            onChange={(e) => setHours(Number(e.target.value))} className="icpx-range mb-3" />
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground/40 uppercase tracking-wider">
            <span>1h</span><span>30 days</span>
          </div>

          {/* comparison bar */}
          <div className="mt-10 space-y-4">
            <div>
              <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                <span>Cloud market rate</span><span>${fmt(marketTotal)}</span>
              </div>
              <div className="h-[2px] bg-white/5 overflow-hidden">
                <div className="h-full bg-white/20" style={{ width: "100%" }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-primary mb-2 font-bold">
                <span>Cookie Run rate</span><span>${fmt(prefundTotal)}</span>
              </div>
              <div className="h-[2px] bg-white/5 overflow-hidden">
                <motion.div className="h-full bg-primary" animate={{ width: `${prefundBarPct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Output */}
        <div className="p-8 lg:p-10 flex flex-col justify-between bg-black/40">
          <div>
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-3">Estimated Saving</div>
            <div className="flex items-end gap-3 mb-2">
              <span className="font-mono font-black text-[64px] lg:text-[72px] leading-none text-primary tabular-nums tracking-tighter">
                ${fmt(saved)}
              </span>
            </div>
            <div className="font-mono text-[14px] text-primary/80 mb-10 font-bold">-{savedPct}% vs cloud market rate</div>

            <div className="space-y-0 overflow-hidden border border-white/10">
              {[
                ["Cloud market cost", `$${fmt(marketTotal)}`],
                ["Cookie Run rate", `$${fmt(prefundTotal)}`],
              ].map(([k, v], i) => (
                <div key={k} className="flex justify-between items-center px-5 py-3.5 font-mono text-[12px]"
                  style={i < 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}>
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-bold tabular-nums text-[13px]">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 px-5 py-4 font-mono text-[11px] leading-relaxed text-muted-foreground/70 bg-white/5 border border-white/10">
            Rates are indicative and based on typical provider pricing at the time of quoting. Final amount is confirmed before you pay.
          </div>
        </div>
      </div>
    </div>
  );
}
