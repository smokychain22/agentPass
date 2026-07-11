import type { Phase1PluginId } from "./fix-plugins/phase1-plugins";
import {
  runFullBaselineChecks,
  buildBaselineReport,
  type BaselineCheck,
  type BaselineVerificationReport,
} from "./baseline-verification";

export type VerificationProfileName =
  | "unused_import"
  | "unused_dependency"
  | "file_deletion"
  | "full_repository";

const PROFILE_CHECKS: Record<VerificationProfileName, string[]> = {
  unused_import: ["import validation", "typecheck", "lint"],
  unused_dependency: ["import validation", "typecheck", "package integrity", "build"],
  file_deletion: ["import validation", "typecheck", "lint", "build", "test"],
  full_repository: [
    "import validation",
    "typecheck",
    "lint",
    "test",
    "build",
    "package integrity",
  ],
};

export function resolveVerificationProfile(pluginId: Phase1PluginId): VerificationProfileName {
  switch (pluginId) {
    case "remove_unused_import":
      return "unused_import";
    case "remove_unused_dependency":
      return "unused_dependency";
    case "remove_temp_file":
    case "remove_empty_file":
    case "remove_confirmed_unused_file":
    case "consolidate_exact_duplicate":
      return "file_deletion";
    default:
      return "full_repository";
  }
}

function filterChecks(checks: BaselineCheck[], profile: VerificationProfileName): BaselineCheck[] {
  const allowed = new Set(PROFILE_CHECKS[profile]);
  return checks.filter((c) => allowed.has(c.name) || c.name.endsWith("(comparison)"));
}

export async function runProfiledBaselineChecks(
  rootDir: string,
  pluginId: Phase1PluginId,
  phase: "baseline" | "after"
): Promise<BaselineCheck[]> {
  const profile = resolveVerificationProfile(pluginId);
  const all = await runFullBaselineChecks(rootDir, phase);
  return filterChecks(all, profile);
}

export function buildProfiledReport(
  baseline: BaselineCheck[],
  after: BaselineCheck[]
): BaselineVerificationReport {
  return buildBaselineReport(baseline, after);
}

export function profileCheckNames(pluginId: Phase1PluginId): string[] {
  return PROFILE_CHECKS[resolveVerificationProfile(pluginId)];
}
