import { Buffer } from "buffer";

// Solana web3.js expects a Node-style global `Buffer` (and `global`) to exist in
// the browser. Assign them before any Solana module is imported.
const g = globalThis as unknown as { Buffer?: unknown; global?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
