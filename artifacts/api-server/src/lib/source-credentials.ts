import { randomBytes } from "node:crypto";

const CREDENTIAL_TTL_MS = 30 * 60 * 1000;
const MAX_CREDENTIALS = 500;

export type SourceCredentialProvider = "github" | "registry";
export type SourceCredentialStatus =
  | "ready"
  | "permission_denied"
  | "expired"
  | "error";

type StoredCredential =
  | {
      provider: "github";
      token: string;
      createdAt: number;
      expiresAt: number;
      rentalId?: number;
    }
  | {
      provider: "registry";
      username: string;
      token: string;
      registryHost?: string;
      createdAt: number;
      expiresAt: number;
      rentalId?: number;
    };

const credentials = new Map<string, StoredCredential>();

function prune(now = Date.now()): void {
  for (const [ref, value] of credentials) {
    if (value.expiresAt <= now) credentials.delete(ref);
  }
  while (credentials.size >= MAX_CREDENTIALS) {
    const oldest = credentials.keys().next().value;
    if (!oldest) break;
    credentials.delete(oldest);
  }
}

function newRef(): string {
  return randomBytes(32).toString("base64url");
}

export async function authorizeSourceCredential(input: {
  provider: SourceCredentialProvider;
  token: string;
  username?: string;
  registryHost?: string;
}): Promise<{
  status: SourceCredentialStatus;
  message: string;
  credentialRef?: string;
}> {
  prune();

  // GitHub credentials must arrive from a provider OAuth connection. Do not
  // accept a browser-submitted PAT, even though the in-memory vault is bounded:
  // the raw bearer token still crossed the application boundary unnecessarily.
  if (input.provider === "github") {
    return {
      status: "permission_denied",
      message:
        "Private GitHub access requires a connected provider OAuth account. Raw GitHub tokens are not accepted.",
    };
  }

  const token = input.token.trim();
  if (!token) {
    return { status: "error", message: "Enter an access token." };
  }

  const username = input.username?.trim();
  const registryHost = input.registryHost?.trim().toLowerCase();
  if (!username) {
    return { status: "permission_denied", message: "Enter the registry username." };
  }
  if (registryHost && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/.test(registryHost)) {
    return { status: "error", message: "Enter a valid registry host." };
  }

  // The registry credential is intentionally not sent through the rental quote
  // endpoint. Vast accepts image_login during image pull, so the token can stay
  // in this bounded process-memory vault until the paid provisioning attempt.
  const ref = newRef();
  const now = Date.now();
  credentials.set(ref, {
    provider: "registry",
    username,
    token,
    registryHost: registryHost || undefined,
    createdAt: now,
    expiresAt: now + CREDENTIAL_TTL_MS,
  });
  return {
    status: "ready",
    message: "Registry access is ready for this workspace.",
    credentialRef: ref,
  };
}

export function getSourceCredential(
  ref: string | undefined,
  provider: SourceCredentialProvider,
): StoredCredential | undefined {
  if (!ref) return undefined;
  prune();
  const value = credentials.get(ref);
  if (!value || value.provider !== provider) return undefined;
  return value;
}

export function attachSourceCredential(
  ref: string | undefined,
  provider: SourceCredentialProvider,
  rentalId: number,
): boolean {
  const value = getSourceCredential(ref, provider);
  if (!value || value.rentalId !== undefined) return false;
  value.rentalId = rentalId;
  return true;
}

export function getSourceCredentialsForRental(rentalId: number): {
  github?: Extract<StoredCredential, { provider: "github" }>;
  registry?: Extract<StoredCredential, { provider: "registry" }>;
} {
  prune();
  const result: ReturnType<typeof getSourceCredentialsForRental> = {};
  for (const value of credentials.values()) {
    if (value.rentalId !== rentalId) continue;
    if (value.provider === "github") result.github = value;
    if (value.provider === "registry") result.registry = value;
  }
  return result;
}

export function releaseSourceCredentialsForRental(rentalId: number): void {
  for (const [ref, value] of credentials) {
    if (value.rentalId === rentalId) credentials.delete(ref);
  }
}