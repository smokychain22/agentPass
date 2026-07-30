/**
 * Parses `openclaw plugins inspect <id> --runtime --json` output. Shape
 * verified directly against a real run of the pinned openclaw@2026.7.1-2
 * CLI inside the actual built Dockerfile.seller image (docker exec),
 * captured verbatim in
 * test/fixtures/openclaw-plugins-inspect-repodiet-a2a-bridge.real-output.json
 * — not guessed.
 *
 * Shared by scripts/seller-runtime-supervisor.ts (startup-time fail-closed
 * check) and scripts/seller-production-readiness.ts (independent
 * re-verification), so both use exactly the same real-verified parsing
 * rather than two hand-maintained copies that could drift.
 */
export interface PluginInspectionShape {
  plugin?: { id?: string; status?: string; activated?: boolean };
  typedHooks?: Array<{ name?: string }>;
}

/**
 * Requires `plugin.status === "loaded"`, `plugin.activated === true`, and
 * the given hook name present in `typedHooks` — a plugin id merely
 * appearing somewhere in the output (e.g. inside an error message) is not
 * accepted as proof of activation.
 */
export function parsePluginInspection(stdout: string, pluginId: string, requiredHookName: string): boolean {
  let parsed: PluginInspectionShape;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return false;
  }
  if (parsed.plugin?.id !== pluginId) return false;
  if (parsed.plugin?.status !== "loaded") return false;
  if (parsed.plugin?.activated !== true) return false;
  const hooks = parsed.typedHooks ?? [];
  return hooks.some((hook) => hook?.name === requiredHookName);
}
