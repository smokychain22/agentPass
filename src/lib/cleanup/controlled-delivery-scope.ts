/**
 * Fail-closed cleanup authorization for unsafe scopes.
 * Hard-rejects runtime/config/generated/route paths.
 * Does not advertise internal test-only preferred paths to customers.
 */

const REJECT_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)config\//i, reason: "runtime/config path" },
  { pattern: /runtime-hook/i, reason: "runtime/config path" },
  { pattern: /(^|\/)generated\//i, reason: "generated file" },
  { pattern: /\.generated\./i, reason: "generated file" },
  { pattern: /(^|\/)(app|pages)\//i, reason: "route/layout/page" },
  { pattern: /src\/(app|pages)\//i, reason: "route/layout/page" },
  { pattern: /(route|layout|page)\.(t|j)sx?$/i, reason: "route/layout/page" },
  { pattern: /plugin|registry/i, reason: "plugin registry" },
  { pattern: /side[-_]?effect/i, reason: "side-effect registration" },
];

/** @deprecated Internal test helper only — never show in Production customer UI. */
export const CONTROLLED_DELIVERY_PREFERRED_PATHS = [
  "src/unused/empty-module.ts",
  "src/unused/confirmed-unused.ts",
] as const;

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
      message: `This cleanup scope is blocked for automatic Fix & PR: ${rejected
        .map((r) => `${r.path} (${r.reason})`)
        .join("; ")}. Additional verification or a generator/config-aware plan is required.`,
    };
  }

  return {
    allowed: true,
    preferred: paths.every((path) => isControlledDeliveryPreferredPath(path)),
    rejected: [],
    message: null,
  };
}
