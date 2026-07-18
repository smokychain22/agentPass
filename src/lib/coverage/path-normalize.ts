/**
 * Repo-relative path normalization for pinned-commit coverage inventory.
 * Keeps unicode; only trims trailing newlines (not surrounding whitespace).
 */

const WINDOWS_DRIVE = /^[a-zA-Z]:(\/|\\)/;

export function assertSafeRepoRelativePath(exact: string): void {
  if (typeof exact !== "string") {
    throw new Error("unsafe_repo_path:not_a_string");
  }
  const unified = exact.replace(/\\/g, "/");
  if (unified.length === 0) {
    throw new Error("unsafe_repo_path:empty");
  }
  if (unified.startsWith("/") || WINDOWS_DRIVE.test(unified) || unified.startsWith("//")) {
    throw new Error(`unsafe_repo_path:absolute:${exact}`);
  }
  if (unified.includes("\0")) {
    throw new Error("unsafe_repo_path:nul");
  }
  const segments = unified.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error(`unsafe_repo_path:traversal:${exact}`);
    }
  }
}

/**
 * Unify separators to `/`, reject absolute / `..` traversal, keep unicode.
 * Trims only trailing `\r` / `\n` (git path records may carry them).
 */
export function normalizeRepoRelativePath(exact: string): string {
  let s = exact.replace(/\\/g, "/");
  s = s.replace(/[\r\n]+$/g, "");
  assertSafeRepoRelativePath(s);
  while (s.startsWith("./")) {
    s = s.slice(2);
  }
  s = s.replace(/\/{2,}/g, "/");
  if (s.endsWith("/") && s.length > 1) {
    s = s.replace(/\/+$/g, "");
  }
  if (s.length === 0 || s === ".") {
    throw new Error("unsafe_repo_path:empty_after_normalize");
  }
  assertSafeRepoRelativePath(s);
  return s;
}
