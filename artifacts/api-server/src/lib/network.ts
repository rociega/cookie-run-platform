// Synthetic network telemetry for the public homepage.
//
// The marketing homepage shows a "live" counters + activity feed. The numbers
// are NOT real, but their *origin* lives here on the server (not inspectable in
// the client bundle). Everything is deterministic:
//   - cumulative counters grow monotonically from a fixed epoch, so they are
//     identical across autoscale instances and survive restarts;
//   - feed entries are derived from fixed time buckets (one per ~1.5s) seeded by
//     a PRNG, so consecutive polls overlap and the client list merges smoothly
//     instead of churning every entry.

export interface FeedEntry {
  id: string;
  type: "job" | "burn" | "route" | "stake";
  jobId: string;
  wallet: string;
  gpu: string;
  cluster: string;
  cost: string;
  burn: string;
  ts: string;
}

export interface NetworkCounters {
  nodes: number;
  jobsProcessed: number;
  pflops: number;
  icpxBurned: number;
}

export interface NetworkStatsPayload {
  stats: NetworkCounters;
  activity: FeedEntry[];
}

// Fixed origin — never process boot time — so counters are stable everywhere.
const EPOCH_MS = Date.UTC(2026, 5, 1);
const BUCKET_MS = 1500;
const FEED_COUNT = 18;

const GPUS = [
  "h100-sxm5-80gb",
  "h100-pcie-80gb",
  "a100-sxm4-80gb",
  "a100-pcie-40gb",
  "rtx4090-24gb",
  "l40s-48gb",
  "rtx6000ada-48gb",
  "h200-sxm-141gb",
];
const CLUSTERS = [
  "us-east-1",
  "us-west-2",
  "eu-west-3",
  "eu-central-1",
  "ap-south-1",
  "ap-northeast-2",
  "sa-east-1",
];
const TYPES: FeedEntry["type"][] = ["job", "job", "job", "route", "route", "burn", "stake"];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Deterministic PRNG (mulberry32) seeded by an integer bucket index.
function rngFor(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function fmtTs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}`;
}

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

function maskedWallet(r: () => number): string {
  const seg = (n: number) =>
    Array.from({ length: n }, () => B58[Math.floor(r() * B58.length)]).join("");
  return `${seg(4)}…${seg(4)}`;
}

function entryForBucket(bucket: number): FeedEntry {
  const r = rngFor(bucket ^ 0x9e3779b9);
  const type = pick(r, TYPES);
  const jobId = `0x${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0")}`;
  const cost = (0.02 + r() * 4.8).toFixed(2);
  const burn = (5 + Math.floor(r() * 195)).toString();
  const tsMs = bucket * BUCKET_MS + Math.floor(r() * BUCKET_MS);
  return {
    id: String(bucket),
    type,
    jobId,
    wallet: maskedWallet(r),
    gpu: pick(r, GPUS),
    cluster: pick(r, CLUSTERS),
    cost,
    burn,
    ts: fmtTs(tsMs),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function networkStats(): NetworkStatsPayload {
  const now = Date.now();
  const elapsed = Math.max(0, (now - EPOCH_MS) / 1000);

  // Fluctuating gauges (banded, refresh on a slow bucket).
  const gaugeBucket = Math.floor(now / 30_000);
  const nodes = 24 + Math.floor(rngFor(gaugeBucket ^ 0x85ebca6b)() * 24);
  const pflops = round1(3.2 + rngFor(gaugeBucket ^ 0xc2b2ae35)() * 2.6);

  // Cumulative, monotonic counters anchored at beta-launch baselines.
  const jobsProcessed = 847 + Math.floor(elapsed * 0.006);
  const icpxBurned = 18_400 + Math.floor(elapsed * 0.003);

  const latest = Math.floor(now / BUCKET_MS);
  const activity: FeedEntry[] = [];
  for (let i = 0; i < FEED_COUNT; i++) {
    activity.push(entryForBucket(latest - i));
  }

  return {
    stats: { nodes, jobsProcessed, pflops, icpxBurned },
    activity,
  };
}
