// Server-side catalog of compute workload presets. Each template maps a renter
// selection to a concrete Docker image + startup script + bundled disk + price
// markup. The image and onstart are SERVER-ONLY: they are resolved here from a
// trusted catalog at provision time and never accepted from the client, so a
// caller can't inject an arbitrary image to run on the operator's account.
import {
  ICPX_MARKUP,
  DISK_USD_PER_GB_MONTH,
  INSTANCE_TYPE_MULTIPLIER,
  ORDER_MINIMUM_USD,
} from "./config";

export type TemplateCategory = "dev" | "app" | "inference" | "training" | "game";
export type AccessType = "ssh" | "http";
export type InstanceType = "on-demand" | "spot" | "reserved";

export interface ComputeTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Docker image launched on Vast. Server-only; never trusted from the client. */
  image: string;
  /** Startup script run inside the container. Server-only. */
  onstart?: string;
  /** Disk (GB) bundled with this template before any extra the renter adds. */
  defaultDiskGb: number;
  /** Compute price multiplier layered on top of ICPX_MARKUP. */
  markup: number;
  /** How the renter reaches the workload once it is live. */
  accessType: AccessType;
  /** App port published for http templates (the URL is http://<ip>:<port>). */
  accessPort?: number;
  /** Short, human guidance shown on the rentals dashboard. */
  accessLabel: string;
}

// The client-facing projection. Omits image/onstart so internal provisioning
// details never leak into the bundle or a public endpoint.
export interface PublicComputeTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  markup: number;
  defaultDiskGb: number;
  accessType: AccessType;
  accessPort: number | null;
  accessLabel: string;
}

export const DEFAULT_TEMPLATE_ID = "bare-gpu";

export const TEMPLATES: ComputeTemplate[] = [
  {
    id: "bare-gpu",
    name: "Bare GPU (PyTorch)",
    description:
      "A clean PyTorch + CUDA box. Full SSH access — bring your own code and run anything.",
    category: "dev",
    image: "pytorch/pytorch:latest",
    defaultDiskGb: 30,
    markup: 1.0,
    accessType: "ssh",
    accessLabel: "SSH in and run anything — nothing is preinstalled but PyTorch + CUDA.",
  },
  {
    id: "jupyter",
    name: "Jupyter Lab",
    description:
      "A JupyterLab notebook server with PyTorch + CUDA preinstalled. Code in your browser.",
    category: "dev",
    image: "pytorch/pytorch:latest",
    onstart: [
      "pip install -q jupyterlab",
      "jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --allow-root --ServerApp.token='' --ServerApp.password=''",
    ].join("\n"),
    defaultDiskGb: 40,
    markup: 1.1,
    accessType: "http",
    accessPort: 8888,
    accessLabel: "Open JupyterLab in your browser on port 8888 (no token set).",
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    description:
      "Node-based Stable Diffusion studio. Build image pipelines on a visual web canvas.",
    category: "app",
    image: "pytorch/pytorch:latest",
    onstart: [
      "apt-get update -y && apt-get install -y git",
      "git clone --depth 1 https://github.com/comfyanonymous/ComfyUI /workspace/ComfyUI",
      "cd /workspace/ComfyUI && pip install -r requirements.txt",
      "python main.py --listen 0.0.0.0 --port 8188",
    ].join("\n"),
    defaultDiskGb: 60,
    markup: 1.25,
    accessType: "http",
    accessPort: 8188,
    accessLabel: "Open the ComfyUI canvas in your browser on port 8188.",
  },
  {
    id: "sd-webui",
    name: "Stable Diffusion WebUI",
    description:
      "The AUTOMATIC1111 web UI for txt2img / img2img with extensions and model loading.",
    category: "app",
    image: "pytorch/pytorch:latest",
    onstart: [
      "apt-get update -y && apt-get install -y git",
      "git clone --depth 1 https://github.com/AUTOMATIC1111/stable-diffusion-webui /workspace/sd",
      "cd /workspace/sd",
      "python launch.py --listen --port 7860 --enable-insecure-extension-access --no-half-vae",
    ].join("\n"),
    defaultDiskGb: 60,
    markup: 1.25,
    accessType: "http",
    accessPort: 7860,
    accessLabel: "Open the Stable Diffusion web UI in your browser on port 7860.",
  },
  {
    id: "ollama",
    name: "Ollama Server",
    description:
      "Run open LLMs (Llama, Mistral, Qwen…) behind a local HTTP API. Llama 3.2 prepulled.",
    category: "inference",
    image: "ollama/ollama:latest",
    onstart: [
      "nohup ollama serve > /var/log/ollama.log 2>&1 &",
      "sleep 5",
      "ollama pull llama3.2",
    ].join("\n"),
    defaultDiskGb: 60,
    markup: 1.2,
    accessType: "http",
    accessPort: 11434,
    accessLabel: "Query the Ollama HTTP API on port 11434 (e.g. POST /api/generate).",
  },
  {
    id: "vllm",
    name: "vLLM (OpenAI API)",
    description:
      "An OpenAI-compatible inference server for high-throughput LLM serving via vLLM.",
    category: "inference",
    image: "vllm/vllm-openai:latest",
    onstart: [
      "python3 -m vllm.entrypoints.openai.api_server --host 0.0.0.0 --port 8000 --model facebook/opt-125m",
    ].join("\n"),
    defaultDiskGb: 80,
    markup: 1.3,
    accessType: "http",
    accessPort: 8000,
    accessLabel:
      "Call the OpenAI-compatible API on port 8000 (/v1/chat/completions). Swap the model over SSH.",
  },
  {
    id: "finetune",
    name: "Fine-Tuning Rig (Axolotl)",
    description:
      "Preloaded with Axolotl, PEFT, TRL and bitsandbytes for LoRA / QLoRA fine-tuning.",
    category: "training",
    image: "pytorch/pytorch:latest",
    onstart: [
      "pip install -q axolotl peft bitsandbytes datasets transformers accelerate trl",
    ].join("\n"),
    defaultDiskGb: 100,
    markup: 1.2,
    accessType: "ssh",
    accessLabel: "SSH in; Axolotl + PEFT + TRL are preinstalled for LoRA / QLoRA runs.",
  },
  {
    id: "gameserver",
    name: "Game Server (SteamCMD)",
    description:
      "A SteamCMD base for hosting dedicated game servers. Configure your title over SSH.",
    category: "game",
    image: "cm2network/steamcmd:latest",
    defaultDiskGb: 60,
    markup: 1.15,
    accessType: "ssh",
    accessLabel: "SSH in to install and launch your dedicated server with SteamCMD.",
  },
];

const TEMPLATES_BY_ID: Record<string, ComputeTemplate> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t]),
);

// Exact-match lookup. Returns undefined for an unknown id so callers can reject
// it (the route returns 400 rather than silently substituting a default).
export function findTemplate(id: string): ComputeTemplate | undefined {
  return TEMPLATES_BY_ID[id];
}

// Resolve a (possibly null) stored id to a concrete template, falling back to
// the bare-GPU default. Used at provision time where a row is always valid.
export function resolveTemplate(id: string | null | undefined): ComputeTemplate {
  return (id ? TEMPLATES_BY_ID[id] : undefined) ?? TEMPLATES_BY_ID[DEFAULT_TEMPLATE_ID];
}

export function toPublicTemplate(t: ComputeTemplate): PublicComputeTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    markup: t.markup,
    defaultDiskGb: t.defaultDiskGb,
    accessType: t.accessType,
    accessPort: t.accessPort ?? null,
    accessLabel: t.accessLabel,
  };
}

export function listPublicTemplates(): PublicComputeTemplate[] {
  return TEMPLATES.map(toPublicTemplate);
}

export const INSTANCE_TYPES: InstanceType[] = ["on-demand", "spot", "reserved"];

export function isValidInstanceType(v: string): v is InstanceType {
  return v in INSTANCE_TYPE_MULTIPLIER;
}

// Itemized USD quote for a rental, broken into the parts that make up the final
// charge so the client can show EXACTLY how the price is derived — closing the
// gap between the per-hour "from" price advertised on cards and the order total
// (which carries the order minimum + workload/instance multipliers + disk).
export interface PriceBreakdown {
  /** Base hourly rate of the chosen offer: market dph × white-label markup. */
  baseHourlyUsd: number;
  hours: number;
  /** Workload-template multiplier (1.0 for a bare GPU). */
  templateMarkup: number;
  /** Instance-type multiplier (on-demand 1.0 / spot / reserved). */
  instanceMultiplier: number;
  /** Compute charge: baseHourlyUsd × hours × templateMarkup × instanceMultiplier. */
  computeUsd: number;
  /** Extra-disk charge over the rental term. */
  diskUsd: number;
  /** computeUsd + diskUsd, before the order minimum is applied. */
  subtotalUsd: number;
  /** The order minimum (floor) this quote is measured against. */
  minimumUsd: number;
  /** Final charge: max(subtotalUsd, minimumUsd). Equals the stored priceUsd. */
  totalUsd: number;
  /** True when the order minimum raised the price above the computed subtotal. */
  minimumApplied: boolean;
}

// Single source of truth for rental pricing. Both the amount we charge and the
// breakdown we display come from here, so the floor + multipliers can never
// diverge between them.
//   compute = baseHourly × hours × template markup × type mult
//   disk    = extra GB × (USD/GB-month ÷ 730h) × hours
// Floored at ORDER_MINIMUM_USD to cover fixed provisioning overhead on tiny orders.
export function computePriceBreakdown(opts: {
  dphTotal: number;
  durationHours: number;
  template: ComputeTemplate;
  instanceType: string;
  extraDiskGb: number;
}): PriceBreakdown {
  const { dphTotal, durationHours, template, instanceType, extraDiskGb } = opts;
  const instanceMultiplier = INSTANCE_TYPE_MULTIPLIER[instanceType] ?? 1.0;
  const baseHourlyUsd = dphTotal * ICPX_MARKUP;
  const computeUsd =
    baseHourlyUsd * durationHours * template.markup * instanceMultiplier;
  const diskUsd = extraDiskGb * (DISK_USD_PER_GB_MONTH / 730) * durationHours;
  const subtotalUsd = computeUsd + diskUsd;
  // Round to the same 4 decimals the route persists priceUsd at, so totalUsd, the
  // stored priceUsd, and the derived SOL/ICPX amounts can never disagree by a
  // fractional cent — the whole point of this fix is "shown == charged".
  const totalUsd = Math.round(Math.max(ORDER_MINIMUM_USD, subtotalUsd) * 1e4) / 1e4;
  return {
    baseHourlyUsd,
    hours: durationHours,
    templateMarkup: template.markup,
    instanceMultiplier,
    computeUsd,
    diskUsd,
    subtotalUsd,
    minimumUsd: ORDER_MINIMUM_USD,
    totalUsd,
    minimumApplied: subtotalUsd < ORDER_MINIMUM_USD,
  };
}

// Final USD quote for a rental. Thin wrapper over computePriceBreakdown.
export function computePriceUsd(opts: {
  dphTotal: number;
  durationHours: number;
  template: ComputeTemplate;
  instanceType: string;
  extraDiskGb: number;
}): number {
  return computePriceBreakdown(opts).totalUsd;
}
