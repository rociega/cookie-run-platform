import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  useGetNetworkStats,
  getGetNetworkStatsQueryKey,
  useGetLeaderboard,
  getGetLeaderboardQueryKey,
  type FeedEntry,
} from "@workspace/api-client-react";
import { AppShell } from "@/components/AppShell";
import {
  ArrowLeft,
  Cpu,
  Server,
  Flame,
  Gauge,
  Activity,
  Trophy,
} from "lucide-react";

const SECTION_LABEL =
  "font-mono text-[10px] tracking-[0.3em] uppercase text-primary/70";

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function StatCard({
  Icon,
  label,
  value,
  suffix,
  testId,
}: {
  Icon: typeof Cpu;
  label: string;
  value: string;
  suffix?: string;
  testId: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm" data-testid={testId}>
      <div className="flex items-center justify-between mb-4">
        <Icon className="h-5 w-5 text-primary" />
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-[10px] font-bold text-live tracking-widest uppercase flex items-center gap-1.5"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-live" /> LIVE
        </motion.span>
      </div>
      <div className="font-semibold text-4xl tracking-tight tabular-nums">
        {value}
        {suffix && (
          <span className="text-base text-muted-foreground ml-1 font-medium">{suffix}</span>
        )}
      </div>
      <div className="text-sm font-medium text-muted-foreground mt-2">
        {label}
      </div>
    </div>
  );
}

function feedLabel(e: FeedEntry): string {
  if (e.type === "job") return `Job ${e.jobId} complete`;
  if (e.type === "burn") return `Points settled: ${e.burn} ICPX`;
  if (e.type === "stake") return "Stake bonus claimed";
  return `Routed → ${e.cluster}`;
}
function feedDot(type: string): string {
  return type === "burn" ? "#ffffff" : type === "stake" ? "rgba(255,255,255,0.4)" : "hsl(var(--live))";
}

export default function Stats() {
  const { data: net } = useGetNetworkStats({
    query: {
      refetchInterval: 2000,
      staleTime: 0,
      queryKey: getGetNetworkStatsQueryKey(),
    },
  });
  const { data: leaders } = useGetLeaderboard({
    query: {
      refetchInterval: 30_000,
      queryKey: getGetLeaderboardQueryKey(),
    },
  });

  const stats = net?.stats;
  const activity = net?.activity ?? [];
  const board = leaders ?? [];

  return (
    <AppShell>
      <div className="max-w-[1400px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Title */}
        <div className="mb-8 md:mb-12 max-w-2xl">
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-2">Network telemetry</div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Network <span className="text-primary">Stats</span>
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Real-time machine activity and the top Cookie Run point earners —
            live from the network. Updated continuously.
          </p>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-12">
          <StatCard
            Icon={Server}
            label="Active nodes"
            value={fmtInt(stats?.nodes ?? 0)}
            testId="stat-nodes"
          />
          <StatCard
            Icon={Cpu}
            label="Jobs processed"
            value={fmtInt(stats?.jobsProcessed ?? 0)}
            testId="stat-jobs"
          />
          <StatCard
            Icon={Gauge}
            label="Network compute"
            value={(stats?.pflops ?? 0).toFixed(1)}
            suffix="PFLOPS"
            testId="stat-pflops"
          />
          <StatCard
            Icon={Flame}
            label="Points settled"
            value={fmtInt(stats?.icpxBurned ?? 0)}
            testId="stat-burned"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
          {/* Activity feed */}
          <div
            className="bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-sm"
            data-testid="panel-activity"
          >
            <div
              className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/30"
            >
              <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Network Activity
              </span>
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="text-[10px] font-bold text-live tracking-widest uppercase flex items-center gap-1.5"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-live" /> LIVE
              </motion.span>
            </div>
            <div className="flex-1">
              {activity.length === 0 ? (
                <div className="px-6 py-12 text-sm font-medium text-muted-foreground/50 text-center">
                  Awaiting network activity…
                </div>
              ) : (
                activity.slice(0, 12).map((e) => (
                  <div
                    key={e.id}
                    className="px-6 py-4 flex items-center gap-4 border-b border-border last:border-0"
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: feedDot(e.type) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {feedLabel(e)}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground mt-1 truncate">
                        {e.wallet} ·{" "}
                        {e.gpu.split("-").slice(0, 2).join(" ").toUpperCase()}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground/50 shrink-0 tabular-nums">
                      {e.ts.split(".")[0]}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div
              className="px-6 py-3 text-[10px] font-semibold text-muted-foreground/50 tracking-wider uppercase text-center border-t border-border bg-secondary/10"
            >
              Historical Solana settlement records
            </div>
          </div>

          {/* Leaderboard */}
          <div
            className="bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-sm"
            data-testid="panel-leaderboard"
          >
            <div
              className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/30"
            >
              <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" /> Top Earners
              </span>
              <span className="text-xs font-medium text-muted-foreground/70">
                Cookie Run pts
              </span>
            </div>
            <div className="flex-1">
              {board.length === 0 ? (
                <div className="px-6 py-12 text-sm font-medium text-muted-foreground/50 text-center">
                  No ranked earners yet.
                </div>
              ) : (
                board.slice(0, 12).map((entry) => (
                  <div
                    key={entry.rank}
                    data-testid={`row-leader-${entry.rank}`}
                    className="px-6 py-4 flex items-center gap-4 border-b border-border last:border-0 hover:bg-secondary/30 transition-colors"
                  >
                    <span
                      className={`text-lg font-bold tabular-nums w-8 shrink-0 ${
                        entry.rank <= 3 ? "text-primary" : "text-muted-foreground/50"
                      }`}
                    >
                      {entry.rank}
                    </span>
                    <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">
                      {entry.name}
                    </span>
                    <span className="text-sm font-bold tabular-nums text-primary shrink-0">
                      {Number(entry.balance).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div
              className="px-6 py-3 text-[10px] font-semibold tracking-wider uppercase text-center border-t border-border bg-secondary/10"
            >
              <Link
                href="/rewards"
                data-testid="link-earn"
                className="text-primary hover:text-primary/80 transition-colors"
              >
                Earn Cookie Run points →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
