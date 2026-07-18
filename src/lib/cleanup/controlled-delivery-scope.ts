/**
 * First controlled delivery preferences and hard rejects.
 * Prefer single-file unused deletes under src/unused/ only.
 */

export const CONTROLLED_DELIVERY_PREFERRED_PATHS = [
  "src/unused/empty-module.ts",
  "src/unused/confirmed-unused.ts",
] as const;

const REJECT_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)config\//i, reason: "runtime/config hook" },
  { pattern: /runtime-hook/i, reason: "runtime/config hook" },
  { pattern: /(^|\/)generated\//i, reason: "generated file" },
  { pattern: /\.generated\./i, reason: "generated file" },
  { pattern: /(^|\/)(app|pages)\//i, reason: "route/layout/page" },
  { pattern: /(route|layout|page)\.(t|j)sx?$/i, reason: "route/layout/page" },
  { pattern: /plugin|registry/i, reason: "plugin registry" },
  { pattern: /side[-_]?effect/i, reason: "side-effect registration" },
];

export function normalizeCleanupPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function controlledDeliveryRejectReason(path: string): string | null {
  const normalized = normalizeCleanupPath(path);
  for (const { pattern, reason } of REJECT_PATH_PATTERNS) {
    if (pattern.test(normalized)) return reason;
  }
  return null;
}

export function isControlledDeliveryPreferredPath(path: string): boolean {
  const normalized = normalizeCleanupPath(path);
  return (CONTROLLED_DELIVERY_PREFERRED_PATHS as readonly string[]).includes(normalized);
}

export function evaluateControlledDeliverySelection(paths: string[]): {
  allowed: boolean;
  preferred: boolean;
  rejected: Array<{ path: string; reason: string }>;
  message: string | null;
} {
  const rejected = paths
    .map((path) => {
      const reason = controlledDeliveryRejectReason(path);
      return reason ? { path: normalizeCleanupPath(path), reason } : null;
    })
    .filter((entry): entry is { path: string; reason: string } => Boolean(entry));

  if (rejected.length > 0) {
    return {
      allowed: false,
      preferred: false,
      rejected,
      message: `Controlled delivery rejects ${rejected
        .map((r) => `${r.path} (${r.reason})`)
        .join("; ")}. Prefer ${CONTROLLED_DELIVERY_PREFERRED_PATHS.join(" or ")}.`,
    };
  }

  const preferred = paths.every((path) => isControlledDeliveryPreferredPath(path));
  return {
    allowed: true,
    preferred,
    rejected: [],
    message: preferred
      ? null
      : `Selection is not the preferred first controlled path. Prefer ${CONTROLLED_DELIVERY_PREFERRED_PATHS.join(" or ")}.`,
  };
}
