import { logger } from "./logger";
import { db, sourceRateLimitsTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

const GITHUB_HOST = "github.com";
const GITHUB_API = "https://api.github.com";
export type SourceProtectionEndpoint =
  | "credential-authorization"
  | "github-validation"
  | "workspace-create";

export type SourceProtectionActor = "api_limiter" | "github";
export type SourceProtectionReason = "rate_limit" | "forbidden";

interface SourceProtectionCounter {
  count: number;
  lastLoggedAt: number;
}

const SOURCE_PROTECTION_LOG_INTERVAL_MS = 60 * 1000;
const MAX_SOURCE_PROTECTION_COUNTERS = 8;
const sourceProtectionCounters = new Map<string, SourceProtectionCounter>();

export function recordSourceProtectionEvent(input: {
  endpoint: SourceProtectionEndpoint;
  actor: SourceProtectionActor;
  reason: SourceProtectionReason;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  const key = `${input.endpoint}:${input.actor}:${input.reason}`;
  let counter = sourceProtectionCounters.get(key);
  if (!counter) {
    if (sourceProtectionCounters.size >= MAX_SOURCE_PROTECTION_COUNTERS) {
      const oldest = sourceProtectionCounters.keys().next().value;
      if (oldest) sourceProtectionCounters.delete(oldest);
    }
    counter = { count: 0, lastLoggedAt: 0 };
    sourceProtectionCounters.set(key, counter);
  }

  counter.count += 1;
  if (
    counter.lastLoggedAt !== 0 &&
    now - counter.lastLoggedAt < SOURCE_PROTECTION_LOG_INTERVAL_MS
  ) {
    return;
  }

  counter.lastLoggedAt = now;
  logger.warn(
    {
      event: "source_protection",
      endpoint: input.endpoint,
      actor: input.actor,
      reason: input.reason,
      count: counter.count,
    },
    "source protection pressure detected",
  );
}

export function resetSourceProtectionCountersForTests(): void {
  sourceProtectionCounters.clear();
  sourceRateLimitStoreFailures.clear();
}

export type SourceRateLimitKind =
  | "github-repository-validation"
  | "source-credential-authorization";

export interface SourceRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export class SourceRateLimitStoreError extends Error {
  readonly kind: SourceRateLimitKind;

  constructor(kind: SourceRateLimitKind, options?: ErrorOptions) {
    super("Source rate-limit store is unavailable.", options);
    this.name = "SourceRateLimitStoreError";
    this.kind = kind;
  }
}

const SOURCE_RATE_WINDOW_MS = 60 * 1000;
const SOURCE_RATE_LIMITS: Record<SourceRateLimitKind, number> = {
  // A repository check can make two GitHub API calls, so keep this below the
  // unauthenticated GitHub burst that a single client could otherwise create.
  "github-repository-validation": 6,
  "source-credential-authorization": 5,
};

let lastSharedCleanupAt = 0;
let sharedCleanupPromise: Promise<void> | null = null;
const sourceRateLimitStoreFailures = new Map<
  SourceRateLimitKind,
  SourceProtectionCounter
>();

function recordSourceRateLimitStoreFailure(kind: SourceRateLimitKind): void {
  const now = Date.now();
  let counter = sourceRateLimitStoreFailures.get(kind);
  if (!counter) {
    counter = { count: 0, lastLoggedAt: 0 };
    sourceRateLimitStoreFailures.set(kind, counter);
  }

  counter.count += 1;
  if (
    counter.lastLoggedAt !== 0 &&
    now - counter.lastLoggedAt < SOURCE_PROTECTION_LOG_INTERVAL_MS
  ) {
    return;
  }

  counter.lastLoggedAt = now;
  logger.error(
    {
      event: "source_rate_limiter",
      kind,
      reason: "store_unavailable",
      count: counter.count,
    },
    "source rate-limit store unavailable",
  );
}

function sourceRateLimitKey(clientId: string, kind: SourceRateLimitKind): string {
  return createHash("sha256")
    .update(`${kind}:${clientId}`)
    .digest("hex");
}

async function cleanupExpiredSourceRateLimits(): Promise<void> {
  if (sharedCleanupPromise) {
    await sharedCleanupPromise;
    return;
  }

  const now = Date.now();
  if (now - lastSharedCleanupAt < SOURCE_RATE_WINDOW_MS) return;

  lastSharedCleanupAt = now;
  try {
    const cleanupPromise = db
      .delete(sourceRateLimitsTable)
      .where(lt(sourceRateLimitsTable.resetAt, sql`now()`))
      .then(() => undefined);
    sharedCleanupPromise = cleanupPromise
      .catch((error) => {
        // A failed cleanup must not suppress the next retry for the full
        // window. The shared promise still carries this failure to every
        // check that joined it.
        lastSharedCleanupAt = 0;
        throw error;
      })
      .finally(() => {
        sharedCleanupPromise = null;
      });
  } catch (error) {
    // Query-builder failures can happen before a promise is created.
    lastSharedCleanupAt = 0;
    throw error;
  }
  await sharedCleanupPromise;
}

export async function checkSourceRateLimit(
  clientId: string,
  kind: SourceRateLimitKind,
): Promise<SourceRateLimitResult> {
  try {
    await cleanupExpiredSourceRateLimits();
    const limit = SOURCE_RATE_LIMITS[kind];
    const key = sourceRateLimitKey(clientId, kind);
    const [bucket] = await db
      .insert(sourceRateLimitsTable)
      .values({
        key,
        count: 1,
        resetAt: sql`now() + interval '1 minute'`,
      })
      .onConflictDoUpdate({
        target: sourceRateLimitsTable.key,
        set: {
          count: sql`CASE WHEN ${sourceRateLimitsTable.resetAt} <= now() THEN 1 ELSE ${sourceRateLimitsTable.count} + 1 END`,
          resetAt: sql`CASE WHEN ${sourceRateLimitsTable.resetAt} <= now() THEN now() + interval '1 minute' ELSE ${sourceRateLimitsTable.resetAt} END`,
        },
      })
      .returning({
        count: sourceRateLimitsTable.count,
        resetAt: sourceRateLimitsTable.resetAt,
      });

    if (!bucket) {
      throw new Error("Source rate limit counter was not returned.");
    }

    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000),
      ),
    };
  } catch (error) {
    recordSourceRateLimitStoreFailure(kind);
    throw new SourceRateLimitStoreError(kind, { cause: error });
  }
}

export async function resetSourceRateLimitsForTests(): Promise<void> {
  await db.delete(sourceRateLimitsTable);
  lastSharedCleanupAt = 0;
}

export interface GitHubRepositoryInput {
  repositoryUrl: string;
  revision?: string;
  accessToken?: string;
}

export type GitHubValidation =
  | {
      status: "connected";
      repositoryUrl: string;
      revision: string;
      defaultBranch: string;
      repositoryName: string;
      message: string;
    }
  | {
      status: "permission_required" | "expired" | "error";
      repositoryUrl?: string;
      revision?: string;
      message: string;
    };

function parseGitHubUrl(value: string): { owner: string; repo: string; url: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid https://github.com/owner/repository URL.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== GITHUB_HOST ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Only public HTTPS GitHub repository URLs are supported.");
  }

  const parts = parsed.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("Use a GitHub repository URL in the form github.com/owner/repository.");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw new Error("That GitHub repository URL contains an invalid owner or repository name.");
  }

  return {
    owner,
    repo,
    url: `https://${GITHUB_HOST}/${owner}/${repo}`,
  };
}

function validateRevision(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (
    value.length > 256 ||
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("@{") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/.test(value)
  ) {
    throw new Error("Revision may contain letters, numbers, ., /, _, @, and - only.");
  }
  return value;
}

function isGitHubRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    response.headers.get("x-ratelimit-remaining") === "0"
  );
}

function recordGitHubProtectionEvent(
  endpoint: Extract<SourceProtectionEndpoint, "github-validation" | "credential-authorization">,
  response: Response,
): void {
  recordSourceProtectionEvent({
    endpoint,
    actor: "github",
    reason: isGitHubRateLimited(response) ? "rate_limit" : "forbidden",
  });
}

async function githubGet(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ForgeRun-workspace-bootstrap",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    signal: AbortSignal.timeout(7000),
  });
}

export async function validateGitHubRepository(
  input: GitHubRepositoryInput,
): Promise<GitHubValidation> {
  const { owner, repo, url } = parseGitHubUrl(input.repositoryUrl.trim());
  const requestedRevision = validateRevision(input.revision?.trim());

  let repositoryResponse: Response;
  try {
    repositoryResponse = await githubGet(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      input.accessToken,
    );
  } catch {
    return {
      status: "error",
      repositoryUrl: url,
      message: "GitHub could not be reached. Try again in a moment.",
    };
  }

  if (repositoryResponse.status === 404) {
    return {
      status: "permission_required",
      repositoryUrl: url,
      message:
        "GitHub did not make this repository readable. Use a public repository or connect GitHub before retrying.",
    };
  }
  if (repositoryResponse.status === 403 || repositoryResponse.status === 429) {
    recordGitHubProtectionEvent("github-validation", repositoryResponse);
    return {
      status: "error",
      repositoryUrl: url,
      message: isGitHubRateLimited(repositoryResponse)
        ? "GitHub is rate-limiting repository checks. Try again shortly."
        : "GitHub denied this repository check. Try again shortly.",
    };
  }
  if (!repositoryResponse.ok) {
    return {
      status: "error",
      repositoryUrl: url,
      message: "GitHub could not verify that repository right now.",
    };
  }

  const repository = (await repositoryResponse.json()) as {
    full_name?: unknown;
    default_branch?: unknown;
    private?: unknown;
  };
  const defaultBranch =
    typeof repository.default_branch === "string" && repository.default_branch
      ? repository.default_branch
      : "main";
  const revision = requestedRevision ?? defaultBranch;

  let revisionResponse: Response;
  try {
    revisionResponse = await githubGet(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(revision)}`,
      input.accessToken,
    );
  } catch {
    return {
      status: "error",
      repositoryUrl: url,
      revision,
      message: "GitHub could not verify that revision. Try again in a moment.",
    };
  }

  if (revisionResponse.status === 404) {
    return {
      status: "error",
      repositoryUrl: url,
      revision,
      message: `GitHub could not find revision "${revision}" in this repository.`,
    };
  }
  if (revisionResponse.status === 403 || revisionResponse.status === 429) {
    recordGitHubProtectionEvent("github-validation", revisionResponse);
  }
  if (!revisionResponse.ok) {
    return {
      status: "error",
      repositoryUrl: url,
      revision,
      message: "GitHub could not verify that revision right now.",
    };
  }

  const fullName =
    typeof repository.full_name === "string" && repository.full_name
      ? repository.full_name
      : `${owner}/${repo}`;
  return {
    status: "connected",
    repositoryUrl: url,
    revision,
    defaultBranch,
    repositoryName: fullName,
    message: `GitHub repository verified at ${revision}.`,
  };
}

export async function validateGitHubCredential(token: string): Promise<{
  status: "ready" | "permission_denied" | "expired" | "error";
  message: string;
}> {
  let response: Response;
  try {
    response = await githubGet("/user", token);
  } catch {
    return {
      status: "error",
      message: "GitHub could not be reached. Try again in a moment.",
    };
  }
  if (response.status === 401) {
    return {
      status: "expired",
      message: "GitHub rejected this token. It may be expired or revoked.",
    };
  }
  if (response.status === 403 || response.status === 429) {
    recordGitHubProtectionEvent("credential-authorization", response);
    const rateLimited = isGitHubRateLimited(response);
    return {
      status: rateLimited ? "error" : "permission_denied",
      message: rateLimited
        ? "GitHub is rate-limiting token checks. Try again shortly."
        : "GitHub denied this token. Check its repository-read permission.",
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      message: "GitHub could not verify this token right now.",
    };
  }
  return {
    status: "ready",
    message: "GitHub access is ready for this workspace.",
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildSourceBootstrap(
  repositoryUrl: string,
  revision: string,
  accessTokenEnv?: string,
): string {
  const fetchCommand = accessTokenEnv
    ? `git -c "http.extraHeader=AUTHORIZATION: bearer $${accessTokenEnv}"`
    : "git";
  return [
    ...(accessTokenEnv ? [`trap 'unset ${accessTokenEnv}' EXIT`] : []),
    "command -v git >/dev/null 2>&1 || (apt-get update -y && apt-get install -y git)",
    "rm -rf /workspace/repository",
    "git init /workspace/repository",
    `git -C /workspace/repository remote add origin ${shellQuote(repositoryUrl)}`,
    `${fetchCommand} -C /workspace/repository fetch --depth 1 origin ${shellQuote(revision)}`,
    "git -C /workspace/repository checkout --detach FETCH_HEAD",
    ...(accessTokenEnv ? [`unset ${accessTokenEnv}`] : []),
  ].join(" && ");
}

export function normalizeGitHubRepositoryUrl(value: string): string {
  return parseGitHubUrl(value).url;
}