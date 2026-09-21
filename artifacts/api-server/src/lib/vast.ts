// Thin client for the Vast.ai REST API (v0).
// Search offers:  POST /bundles/   (JSON filter body, Bearer auth)
// Create instance: PUT /asks/{id}/ (accepts an "ask" offer, Bearer auth)
import {
  VAST_API_KEY,
  VAST_API_BASE,
  VAST_API_BASE_V0,
  VAST_DEFAULT_IMAGE,
  VAST_DEFAULT_DISK_GB,
} from "./config";

export interface VastOffer {
  id: number;
  gpuName: string;
  numGpus: number;
  gpuRamGb: number | null;
  dphTotal: number; // dollars per hour (total for the machine)
  geolocation: string | null; // host location string from Vast (e.g. "Sweden, SE")
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${VAST_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function searchOffers(): Promise<VastOffer[]> {
  if (!VAST_API_KEY) throw new Error("VAST_API_KEY is not configured");

  const res = await fetch(`${VAST_API_BASE_V0}/bundles/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      limit: 200,
      type: "on-demand",
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      order: [["dph_total", "asc"]],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vast search failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { offers?: Array<Record<string, unknown>> };
  const offers = data.offers ?? [];

  return offers
    .map((o): VastOffer => {
      const gpuRamMb = o.gpu_ram != null ? Number(o.gpu_ram) : null;
      const geo = o.geolocation != null ? String(o.geolocation).trim() : "";
      return {
        id: Number(o.id),
        gpuName: String(o.gpu_name ?? ""),
        numGpus: Number(o.num_gpus ?? 1),
        gpuRamGb: gpuRamMb != null && gpuRamMb > 0 ? Math.round(gpuRamMb / 1024) : null,
        dphTotal: Number(o.dph_total ?? 0),
        geolocation: geo.length > 0 ? geo : null,
      };
    })
    .filter((o) => Number.isFinite(o.id) && o.dphTotal > 0);
}

// Find the cheapest currently-available offer matching a GPU model name.
// Offers are returned pre-sorted ascending by price, so the first match is cheapest.
export async function getCheapestOffer(model: string): Promise<VastOffer | null> {
  const matches = await getMatchingOffers(model, 1);
  return matches[0] ?? null;
}

// Return up to `limit` available offers matching a GPU model, cheapest first.
// Used by provisioning so it can fall back to the next host when the cheapest
// one's Docker daemon rejects the container create.
export async function getMatchingOffers(model: string, limit = 5): Promise<VastOffer[]> {
  const target = normalize(model);
  if (!target) return [];
  const offers = await searchOffers();
  // Prefer offers whose model name matches EXACTLY (normalized) so checkout
  // quotes the same model the catalog grouped and displayed. Only when no exact
  // match exists do we fall back to a looser substring relation — otherwise an
  // "H200 SXM5" rental could silently price off a cheaper plain "H200" offer,
  // which is exactly the "price shown ≠ charged" drift we want to avoid. Offers
  // are pre-sorted ascending by price, so both buckets stay cheapest-first.
  const exact: VastOffer[] = [];
  const loose: VastOffer[] = [];
  for (const o of offers) {
    const name = normalize(o.gpuName);
    if (name === target) exact.push(o);
    else if (name.includes(target) || target.includes(name)) loose.push(o);
  }
  return (exact.length ? exact : loose).slice(0, limit);
}

// Live connection/status details for a running instance, used to let the renter
// SSH into and monitor the GPU they paid for.
export interface VastInstanceDetail {
  id: string;
  actualStatus: string | null;
  statusMsg: string | null;
  sshHost: string | null;
  sshPort: number | null;
  publicIp: string | null;
  gpuName: string | null;
  numGpus: number | null;
}

// Fetch every instance on the operator account in a single call. The caller
// builds a map by id and merges details into the rentals it owns. Kept fail-soft
// at the call site: a slow/broken Vast API must not take down the rentals list.
export async function getInstances(): Promise<VastInstanceDetail[]> {
  if (!VAST_API_KEY) throw new Error("VAST_API_KEY is not configured");

  const res = await fetch(`${VAST_API_BASE}/instances/`, {
    method: "GET",
    headers: authHeaders(),
    signal: AbortSignal.timeout(7000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vast instances fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { instances?: Array<Record<string, unknown>> };
  const instances = data.instances ?? [];

  return instances.map((o): VastInstanceDetail => {
    const sshPort = o.ssh_port != null ? Number(o.ssh_port) : null;
    const numGpus = o.num_gpus != null ? Number(o.num_gpus) : null;
    return {
      id: String(o.id),
      actualStatus: o.actual_status != null ? String(o.actual_status) : null,
      statusMsg: o.status_msg != null ? String(o.status_msg) : null,
      sshHost: o.ssh_host != null ? String(o.ssh_host) : null,
      sshPort: sshPort != null && Number.isFinite(sshPort) ? sshPort : null,
      publicIp: o.public_ipaddr != null ? String(o.public_ipaddr) : null,
      gpuName: o.gpu_name != null ? String(o.gpu_name) : null,
      numGpus: numGpus != null && Number.isFinite(numGpus) ? numGpus : null,
    };
  });
}

export interface VastInstance {
  instanceId: string;
}

export interface CreateInstanceOpts {
  sshKey?: string | null;
  // Docker image to launch. Resolved from the trusted template catalog, never
  // from the client. Falls back to the operator default when omitted.
  image?: string | null;
  // Startup script run inside the container (template onstart). Server-only.
  onstart?: string | null;
  // Total disk (GB) for the instance (template default + extra). Defaults to the
  // operator default when omitted/invalid.
  diskGb?: number | null;
  // App port to publish for http workloads (mapped via Docker -p so the renter
  // can reach http://<ip>:<port>).
  port?: number | null;
  // When > 0, provision an interruptible (spot) instance by bidding this hourly
  // price on the ask. Omit for a dedicated on-demand instance.
  bidPrice?: number | null;
  // Short-lived Docker registry login used only while Vast pulls a private image.
  // Never include this value in logs or rental persistence.
  imageLogin?: string | null;
  // Runtime environment values used for one-time source checkout. Callers must
  // unset secret values in onstart after the checkout completes.
  env?: Record<string, string>;
}

export async function createInstance(
  offerId: number,
  label: string,
  opts: CreateInstanceOpts = {},
): Promise<VastInstance> {
  if (!VAST_API_KEY) throw new Error("VAST_API_KEY is not configured");

  const body: Record<string, unknown> = {
    image: opts.image || VAST_DEFAULT_IMAGE,
    disk: opts.diskGb && opts.diskGb > 0 ? opts.diskGb : VAST_DEFAULT_DISK_GB,
    runtype: "ssh",
    label,
  };
  if (opts.sshKey) body.ssh_key = opts.sshKey;
  if (opts.onstart) body.onstart = opts.onstart;
  if (opts.imageLogin) body.image_login = opts.imageLogin;
  // Publish the app port through Docker so the workload's web UI/API is
  // reachable on the instance's public IP. Vast's API requires `env` to be a
  // dict (a bare string is rejected with "invalid env type: env must be a
  // dict"); its CLI encodes a port mapping as { "-p 8080:8080": "1" }, so we
  // build the same shape here rather than passing the raw `-p ...` string.
  if ((opts.port && opts.port > 0) || opts.env) {
    body.env = {
      ...(opts.env ?? {}),
      ...(opts.port && opts.port > 0 ? { [`-p ${opts.port}:${opts.port}`]: "1" } : {}),
    };
  }
  // A bid price turns this into an interruptible (spot) contract on Vast.
  if (opts.bidPrice && opts.bidPrice > 0) body.price = opts.bidPrice;

  const res = await fetch(`${VAST_API_BASE_V0}/asks/${offerId}/`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vast create instance failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    success?: boolean;
    new_contract?: number;
    error?: string;
  };

  if (data.success === false || data.new_contract == null) {
    throw new Error(
      `Vast create instance rejected: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }

  return { instanceId: String(data.new_contract) };
}
