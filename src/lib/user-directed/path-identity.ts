/** Stable path identity for repository explorer selection. */

export function normalizeTrackedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function pathIdFor(path: string): string {
  return `path_${normalizeTrackedPath(path)}`;
}

export function pathFromId(pathId: string): string {
  if (pathId.startsWith("path_")) return pathId.slice("path_".length);
  return normalizeTrackedPath(pathId);
}

export function fileNameOf(path: string): string {
  const normalized = normalizeTrackedPath(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function parentDirOf(path: string): string {
  const normalized = normalizeTrackedPath(path);
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "" : normalized.slice(0, idx);
}

export function isUnderPrefix(path: string, prefix: string): boolean {
  const p = normalizeTrackedPath(path);
  const pre = normalizeTrackedPath(prefix);
  if (!pre) return true;
  return p === pre || p.startsWith(`${pre}/`);
}

const GENERATED_RE =
  /(^|\/)(dist|build|out|\.next|coverage|generated)(\/|$)/i;
const VENDOR_RE = /(^|\/)(node_modules|vendor|third_party)(\/|$)/i;

export function pathIndicators(path: string): {
  generated: boolean;
  vendor: boolean;
  protected: boolean;
  indicators: string[];
} {
  const normalized = normalizeTrackedPath(path);
  const generated = GENERATED_RE.test(normalized) || /\.generated\./i.test(normalized);
  const vendor = VENDOR_RE.test(normalized);
  const protectedPath =
    /(^|\/)(app|pages|src\/app|src\/pages)\//i.test(normalized) ||
    /(route|layout|page|middleware)\.(t|j)sx?$/i.test(normalized) ||
    /(^|\/)(config|infra|\.github)\//i.test(normalized) ||
    /runtime-hook|side[-_]?effect|plugin|registry/i.test(normalized) ||
    /\.(lock|yml|yaml|toml)$/i.test(normalized);
  const indicators: string[] = [];
  if (generated) indicators.push("generated");
  if (vendor) indicators.push("vendor");
  if (protectedPath) indicators.push("protected");
  return { generated, vendor, protected: protectedPath, indicators };
}

export function guessLanguage(path: string): string | undefined {
  const ext = normalizeTrackedPath(path).split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    json: "JSON",
    md: "Markdown",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    py: "Python",
    go: "Go",
    rs: "Rust",
    yml: "YAML",
    yaml: "YAML",
  };
  return map[ext];
}
