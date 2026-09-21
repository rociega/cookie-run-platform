const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

export function isValidContainerImage(value: string): boolean {
  const image = value.trim();
  if (
    image.length === 0 ||
    image.length > 255 ||
    /[\s"'`\\;$&|<>()[\]{}]/.test(image) ||
    image.includes("://")
  ) {
    return false;
  }

  const atParts = image.split("@");
  if (atParts.length > 2) return false;
  const reference = atParts[0];
  const digest = atParts[1];
  if (digest !== undefined && (!digest || !DIGEST_RE.test(digest))) return false;

  const segments = reference.split("/");
  if (segments.some((segment) => !segment || !SEGMENT_RE.test(segment.split(":")[0]))) {
    return false;
  }

  const first = segments[0];
  const hasRegistry = segments.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost");
  const repositorySegments = hasRegistry ? segments.slice(1) : segments;
  if (repositorySegments.length === 0) return false;

  const last = repositorySegments[repositorySegments.length - 1];
  const tagSeparator = last.lastIndexOf(":");
  if (tagSeparator >= 0) {
    const tag = last.slice(tagSeparator + 1);
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) return false;
    repositorySegments[repositorySegments.length - 1] = last.slice(0, tagSeparator);
  }
  return repositorySegments.every((segment) => SEGMENT_RE.test(segment));
}

export function validateContainerImage(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  if (!isValidContainerImage(value)) {
    throw new Error(
      "Enter a public OCI image such as ghcr.io/acme/tool:latest or python:3.12-slim.",
    );
  }
  return value.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildRegistryImageLogin(
  image: string,
  credential: { username: string; token: string; registryHost?: string },
): string {
  const registryHost =
    credential.registryHost ??
    (image.split("/").length > 1 && /^[^/]+[.:]/.test(image)
      ? image.split("/")[0]
      : "docker.io");
  return `-u ${shellQuote(credential.username)} -p ${shellQuote(credential.token)} ${registryHost}`;
}