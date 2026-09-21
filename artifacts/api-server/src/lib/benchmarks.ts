// Curated, indicative GPU performance benchmarks for the public comparison page.
// These are approximate, commonly-cited vendor figures meant for *relative*
// comparison only — they are not a live measurement. Served from the API so the
// catalog is a single source of truth and can be enriched later (e.g. joined
// with live market pricing on the client for performance-per-dollar).

export interface BenchmarkEntry {
  model: string;
  vramGb: number;
  fp16Tflops: number; // peak FP16/BF16 tensor throughput (TFLOPS)
  memBandwidthGbs: number; // memory bandwidth (GB/s)
  llmTokensPerSec: number; // Llama 3 8B, single-stream inference (indicative)
  trainingScore: number; // relative training throughput, baseline = 100
}

export interface BenchmarkCatalog {
  benchmarks: BenchmarkEntry[];
  baseline: string; // model that defines trainingScore = 100
  updatedAt: string;
}

// Sorted high-to-low by training score when served.
const BENCHMARKS: BenchmarkEntry[] = [
  { model: "H100 SXM", vramGb: 80, fp16Tflops: 989, memBandwidthGbs: 3350, llmTokensPerSec: 138, trainingScore: 100 },
  { model: "H100 PCIe", vramGb: 80, fp16Tflops: 756, memBandwidthGbs: 2000, llmTokensPerSec: 116, trainingScore: 78 },
  { model: "A100 80GB", vramGb: 80, fp16Tflops: 312, memBandwidthGbs: 2039, llmTokensPerSec: 78, trainingScore: 45 },
  { model: "A100 40GB", vramGb: 40, fp16Tflops: 312, memBandwidthGbs: 1555, llmTokensPerSec: 74, trainingScore: 42 },
  { model: "L40S", vramGb: 48, fp16Tflops: 362, memBandwidthGbs: 864, llmTokensPerSec: 70, trainingScore: 39 },
  { model: "RTX 4090", vramGb: 24, fp16Tflops: 330, memBandwidthGbs: 1008, llmTokensPerSec: 102, trainingScore: 36 },
  { model: "RTX A6000", vramGb: 48, fp16Tflops: 155, memBandwidthGbs: 768, llmTokensPerSec: 58, trainingScore: 22 },
  { model: "RTX 4080", vramGb: 16, fp16Tflops: 195, memBandwidthGbs: 717, llmTokensPerSec: 74, trainingScore: 25 },
  { model: "RTX 3090", vramGb: 24, fp16Tflops: 142, memBandwidthGbs: 936, llmTokensPerSec: 60, trainingScore: 19 },
  { model: "RTX 4070", vramGb: 12, fp16Tflops: 117, memBandwidthGbs: 504, llmTokensPerSec: 44, trainingScore: 13 },
];

const BASELINE = "H100 SXM";

let cached: BenchmarkCatalog | null = null;

export function getBenchmarkCatalog(): BenchmarkCatalog {
  if (!cached) {
    cached = {
      benchmarks: [...BENCHMARKS].sort(
        (a, b) => b.trainingScore - a.trainingScore,
      ),
      baseline: BASELINE,
      updatedAt: new Date().toISOString(),
    };
  }
  return cached;
}
