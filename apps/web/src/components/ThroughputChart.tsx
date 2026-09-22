import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from "recharts";

interface Point { t: number; v: number; }

function seed(): Point[] {
  let v = 68;
  return Array.from({ length: 48 }, (_, i) => {
    v += (Math.random() - 0.5) * 8;
    v = Math.max(42, Math.min(96, v));
    return { t: i, v: Math.round(v * 10) / 10 };
  });
}

export default function ThroughputChart() {
  const [data, setData] = useState<Point[]>(seed);
  const counter = useRef(48);

  useEffect(() => {
    const id = setInterval(() => {
      setData((prev) => {
        const last = prev[prev.length - 1].v;
        let next = last + (Math.random() - 0.48) * 9;
        next = Math.max(42, Math.min(96, next));
        counter.current += 1;
        return [...prev.slice(1), { t: counter.current, v: Math.round(next * 10) / 10 }];
      });
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const current = data[data.length - 1].v;

  return (
    <div className="glass-panel bg-card overflow-hidden h-full flex flex-col" data-testid="throughput-chart">
      <div className="flex items-center justify-between px-5 py-3 relative border-b border-white/10 bg-background/50">
        <span className="mono-label">Network Throughput</span>
        <span className="font-mono text-[10px] text-muted-foreground/60 tracking-widest">PFLOPS · 60s</span>
      </div>
      <div className="px-6 pt-6 pb-2">
        <div className="flex items-end gap-3">
          <span className="font-mono font-black text-[56px] leading-none text-primary tabular-nums tracking-tighter">{current.toFixed(1)}</span>
          <span className="font-mono text-[12px] text-muted-foreground mb-2 uppercase tracking-widest font-bold">PFLOPS FP16</span>
        </div>
      </div>
      <div className="flex-1 min-h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="thru" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={[30, 100]} hide />
            <Tooltip
              contentStyle={{ background: "#000000", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 0, fontFamily: "var(--app-font-mono)", fontSize: 11 }}
              itemStyle={{ color: "#ffffff" }}
              labelStyle={{ display: "none" }}
              formatter={(v: number) => [`${v} PFLOPS`, ""]}
            />
            <Area type="monotone" dataKey="v" stroke="rgba(255,255,255,0.4)" strokeWidth={1} fill="url(#thru)" isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
