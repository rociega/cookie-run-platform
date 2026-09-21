// Public, aggregated view of the live Vast.ai market for the GPU explorer.
// Raw offers are grouped by GPU model into one card per model with the cheapest
// hourly price (USD + ETH, the payment currency on Robinhood Chain) and the
// regions it is available in. The result is cached briefly so the public
// endpoint can be polled for "live" data without hammering Vast on every request.
import { searchOffers, type VastOffer } from "./vast";
import { ICPX_MARKUP, ORDER_MINIMUM_USD } from "./config";
import { ETH_SIMULATED_PRICE_MULTIPLIER, getEthUsd } from "./robinhood";

export interface GpuCatalogEntry {
  model: string;
  gpuRamGb: number | null;
  available: number; // number of distinct offers for this model
  totalGpus: number; // sum of GPUs across those offers
  fromUsdHr: number; // cheapest hourly price (USD), markup applied
  fromEthHr: number; // cheapest hourly price (ETH, on Robinhood Chain)
  regions: string[];
}

export interface GpuCatalog {
  gpus: GpuCatalogEntry[];
  regions: string[];
  ethUsd: number;
  orderMinimumUsd: number; // every rental order is floored at this USD amount
  updatedAt: string;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Vast geolocation strings look like "Sweden, SE" or sometimes just "US". Reduce
// them to a short, dedupe-friendly label (the trailing country code when present).
function regionLabel(geo: string | null): string | null {
  if (!geo) return null;
  const parts = geo
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function buildCatalog(offers: VastOffer[], ethUsd: number): GpuCatalog {
  const groups = new Map<string, VastOffer[]>();
  for (const o of offers) {
    const name = o.gpuName.trim();
    if (!name || o.dphTotal <= 0) continue;
    const arr = groups.get(name) ?? [];
    arr.push(o);
    groups.set(name, arr);
  }

  const allRegions = new Set<string>();
  const gpus: GpuCatalogEntry[] = [];

  for (const [model, arr] of groups) {
    const minDph = Math.min(...arr.map((o) => o.dphTotal));
    const fromUsdHr = minDph * ICPX_MARKUP;
    const ramValues = arr
      .map((o) => o.gpuRamGb)
      .filter((v): v is number => v != null && v > 0);
    const regions = new Set<string>();
    for (const o of arr) {
      const r = regionLabel(o.geolocation);
      if (r) {
        regions.add(r);
        allRegions.add(r);
      }
    }
    gpus.push({
      model,
      gpuRamGb: ramValues.length ? Math.max(...ramValues) : null,
      available: arr.length,
      totalGpus: arr.reduce((s, o) => s + (o.numGpus > 0 ? o.numGpus : 1), 0),
      fromUsdHr: round(fromUsdHr, 4),
      fromEthHr: round(
        (fromUsdHr / ethUsd) * ETH_SIMULATED_PRICE_MULTIPLIER,
        6,
      ),
      regions: [...regions].sort(),
    });
  }

  gpus.sort((a, b) => a.fromUsdHr - b.fromUsdHr);

  return {
    gpus,
    regions: [...allRegions].sort(),
    ethUsd: round(ethUsd, 2),
    orderMinimumUsd: ORDER_MINIMUM_USD,
    updatedAt: new Date().toISOString(),
  };
}

// Live market data is expensive to assemble (one Vast search + price lookup),
// so cache it briefly. Polling clients reuse the same snapshot within the TTL.
const CACHE_TTL_MS = 45_000;
let cache: { data: GpuCatalog; expires: number } | null = null;

export async function getGpuCatalog(): Promise<GpuCatalog> {
  if (cache && cache.expires > Date.now()) return cache.data;

  const offers = await searchOffers();
  const ethUsd = Number(await getEthUsd());

  const data = buildCatalog(offers, ethUsd);
  cache = { data, expires: Date.now() + CACHE_TTL_MS };
  return data;
}
