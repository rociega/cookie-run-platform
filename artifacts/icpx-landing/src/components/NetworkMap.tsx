import { useMemo } from "react";
import { motion } from "framer-motion";

interface Node {
  x: number;
  y: number;
  city: string;
  hub?: boolean;
}

/* equirectangular-ish layout on a 1000 x 460 canvas */
const NODES: Node[] = [
  { x: 161, y: 135, city: "San Francisco", hub: true },
  { x: 250, y: 118, city: "Toronto" },
  { x: 294, y: 128, city: "New York", hub: true },
  { x: 372, y: 289, city: "São Paulo" },
  { x: 500, y: 100, city: "London", hub: true },
  { x: 522, y: 102, city: "Frankfurt" },
  { x: 506, y: 112, city: "Paris" },
  { x: 508, y: 215, city: "Lagos" },
  { x: 560, y: 150, city: "Istanbul" },
  { x: 653, y: 166, city: "Dubai" },
  { x: 700, y: 181, city: "Mumbai", hub: true },
  { x: 786, y: 228, city: "Singapore", hub: true },
  { x: 850, y: 132, city: "Seoul" },
  { x: 886, y: 140, city: "Tokyo", hub: true },
  { x: 919, y: 314, city: "Sydney" },
];

const ARC_PAIRS: [number, number][] = [
  [0, 2], [2, 4], [4, 5], [4, 9], [9, 10], [10, 11],
  [11, 13], [13, 0], [2, 3], [4, 7], [11, 14], [13, 12],
  [0, 11], [4, 10],
];

function arcPath(a: Node, b: Node) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const lift = Math.min(dist * 0.28, 90);
  return `M ${a.x} ${a.y} Q ${mx} ${my - lift} ${b.x} ${b.y}`;
}

export default function NetworkMap() {
  const arcs = useMemo(
    () => ARC_PAIRS.map(([i, j], k) => ({ id: `arc-${k}`, d: arcPath(NODES[i], NODES[j]), dur: 2.4 + (k % 5) * 0.6 })),
    []
  );

  return (
    <div className="glass-panel bg-card overflow-hidden" data-testid="network-map">
      <div className="flex items-center justify-between px-5 py-3 relative border-b border-white/10 bg-background/50">
        <span className="mono-label">Global GPU Deployment Regions</span>
        <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
          className="font-mono text-[10px] text-live tracking-widest">● AVAILABILITY VERIFIED PER REQUEST</motion.span>
      </div>

      <div className="relative">
        <svg viewBox="0 0 1000 460" className="w-full block" style={{ background: "transparent" }}>
          <defs>
            <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.05" />
            </linearGradient>
            <radialGradient id="nodeGlow">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* graticule */}
          <g stroke="rgba(255,255,255,0.02)" strokeWidth="1">
            {Array.from({ length: 11 }, (_, i) => (
              <line key={`v${i}`} x1={i * 100} y1="0" x2={i * 100} y2="460" />
            ))}
            {Array.from({ length: 6 }, (_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 92} x2="1000" y2={i * 92} />
            ))}
          </g>

          {/* arcs */}
          {arcs.map((a) => (
            <path key={a.id} id={a.id} d={a.d} fill="none" stroke="url(#arcGrad)" strokeWidth="1" strokeDasharray="4 2" />
          ))}

          {/* traveling packets */}
          {arcs.map((a) => (
            <circle key={`p-${a.id}`} r="1.5" fill="hsl(var(--live))">
              <animateMotion dur={`${a.dur}s`} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${a.id}`} xlinkHref={`#${a.id}`} />
              </animateMotion>
              <animate attributeName="opacity" values="0;1;1;0" dur={`${a.dur}s`} repeatCount="indefinite" />
            </circle>
          ))}

          {/* nodes */}
          {NODES.map((n, i) => (
            <g key={n.city}>
              <circle cx={n.x} cy={n.y} r="12" fill="url(#nodeGlow)" opacity={n.hub ? 0.3 : 0.15} />
              <circle className="map-pulse" cx={n.x} cy={n.y} r="3" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1"
                style={{ animationDelay: `${(i % 6) * 0.4}s`, transformBox: "fill-box" }} />
              <circle cx={n.x} cy={n.y} r={n.hub ? 2.5 : 1.5} fill="#ffffff" />
              {n.hub && (
                <text x={n.x + 8} y={n.y + 3} fill="rgba(255,255,255,0.7)"
                  fontFamily="var(--app-font-mono)" fontSize="10" letterSpacing="0.05em" fontWeight="400">
                  {n.city}
                </text>
              )}
            </g>
          ))}
        </svg>

        {/* corner readout */}
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10px] text-muted-foreground/60 tracking-wider">
          <span>NVIDIA H100 · A100 · RTX</span>
          <span>Telemetry coming after provider verification</span>
        </div>
      </div>
    </div>
  );
}
