function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

export function normalizeContractPath(value: string): string {
  const normalized = normalizeSlashes(value.trim());
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`contract_path_not_relative:${value}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || !segment)) {
    throw new Error(`contract_path_traversal:${value}`);
  }
  if (normalized.includes("\0")) {
    throw new Error("contract_path_null_byte");
  }
  return normalized;
}

export function normalizeProjectRoot(value: string): string {
  if (value.trim() === ".") return ".";
  return normalizeContractPath(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/** Minimal deterministic glob matcher supporting *, ** and ?. */
export function contractPathMatches(pattern: string, candidate: string): boolean {
  const normalizedPattern = normalizeContractPath(pattern);
  const normalizedCandidate = normalizeContractPath(candidate);
  const token = "\u0001";
  const source = escapeRegex(normalizedPattern)
    .replace(/\*\*/g, token)
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(new RegExp(token, "g"), ".*");
  return new RegExp(`^${source}$`).test(normalizedCandidate);
}

export function isPathAllowed(
  candidate: string,
  allowedPaths: string[],
  protectedPaths: string[]
): boolean {
  const protectedMatch = protectedPaths.some((pattern) => contractPathMatches(pattern, candidate));
  if (protectedMatch) return false;
  return allowedPaths.some((pattern) => contractPathMatches(pattern, candidate));
}
