// Ephemeral, per-agent-run SSH credential.
//
// Agent Run needs the SERVER (not a browser tab) to be able to SSH into the
// rented instance and keep working after the user navigates away. The rest of
// the platform never holds an SSH private key — the browser terminal
// (terminal.ts) receives the user's key over the WebSocket and never persists
// it. To keep that same "never persisted" guarantee for a server-driven
// session, we generate a fresh ed25519 keypair per agent run, register only
// the PUBLIC half with Vast at instance-creation time (via the existing
// `sshKey` field), and hold the PRIVATE half in this bounded in-memory map
// for the lifetime of the run only. It is never written to the database,
// never logged, and is deleted as soon as the run ends (success, failure, or
// stop) or after a bounded TTL if a run never completes.
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const KEY_TTL_MS = 6 * 60 * 60 * 1000; // matches terminal.ts's max session bound

interface StoredKey {
  privateKey: string;
  publicKey: string;
  expiresAt: number;
}

const keysByRentalId = new Map<number, StoredKey>();

function prune(now = Date.now()): void {
  for (const [rentalId, value] of keysByRentalId) {
    if (value.expiresAt <= now) keysByRentalId.delete(rentalId);
  }
}

// Generates a fresh ed25519 keypair in a private temp dir, reads both halves
// into memory, then removes the temp files immediately — nothing durable ever
// holds the private key.
export async function generateAgentSshKeypair(
  rentalId: number,
): Promise<{ publicKey: string }> {
  const dir = await mkdtemp(join(tmpdir(), "forgerun-agent-key-"));
  const keyPath = join(dir, "id_ed25519");
  try {
    await execFileAsync("ssh-keygen", [
      "-t",
      "ed25519",
      "-f",
      keyPath,
      "-N",
      "",
      "-C",
      `forgerun-agent-run-${rentalId}`,
      "-q",
    ]);
    const [privateKey, publicKey] = await Promise.all([
      readFile(keyPath, "utf8"),
      readFile(`${keyPath}.pub`, "utf8"),
    ]);
    prune();
    keysByRentalId.set(rentalId, {
      privateKey,
      publicKey: publicKey.trim(),
      expiresAt: Date.now() + KEY_TTL_MS,
    });
    return { publicKey: publicKey.trim() };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((err) => {
      logger.warn({ err, rentalId }, "agent-ssh: failed to clean up temp keygen dir");
    });
  }
}

export function getAgentPrivateKey(rentalId: number): string | undefined {
  prune();
  return keysByRentalId.get(rentalId)?.privateKey;
}

export function releaseAgentSshKeypair(rentalId: number): void {
  keysByRentalId.delete(rentalId);
}

// Vast's ssh_key field accepts an authorized_keys-style blob, so a
// user-pasted key (for their own terminal access) can ride alongside the
// agent's own key on the same line-separated value.
export function combineSshKeys(...keys: Array<string | null | undefined>): string {
  return keys
    .map((k) => k?.trim())
    .filter((k): k is string => !!k)
    .join("\n");
}

export function randomLabelSuffix(): string {
  return randomBytes(4).toString("hex");
}
