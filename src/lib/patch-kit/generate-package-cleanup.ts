import type { Finding, FindingsPayload } from "@/lib/findings/types";
import type { PackageManager } from "@/lib/scanner/types";

const EMPTY_MD = `# Package Cleanup Suggestions

No dependency removal suggestions were generated.

Reason: no unused dependency findings were available from the current scan.
`;

const FALLBACK_WARNING = `> **Review before removing.** These suggestions were produced by fallback dependency analysis. Confirm usage in config files, dynamic imports, scripts, and build tooling before uninstalling.`;

function uninstallCommand(manager: PackageManager, packageName: string): string {
  switch (manager) {
    case "pnpm":
      return `pnpm remove ${packageName}`;
    case "yarn":
      return `yarn remove ${packageName}`;
    case "bun":
      return `bun remove ${packageName}`;
    default:
      return `npm uninstall ${packageName}`;
  }
}

function usesFallbackAnalysis(findings: FindingsPayload, dependencies: Finding[]): boolean {
  if (findings.rawToolReports.knip === "fallback") return true;
  return dependencies.some((dep) => dep.source === "knip_fallback");
}

function maySuggestUninstallCommand(dep: Finding, fallbackMode: boolean): boolean {
  if (fallbackMode) return false;
  return dep.source === "knip" && dep.confidence >= 0.84;
}

export function generatePackageCleanup(
  findings: FindingsPayload,
  packageManager: PackageManager = "npm"
): string {
  const dependencies = findings.unused.dependencies;

  if (dependencies.length === 0) {
    return EMPTY_MD;
  }

  const fallbackMode = usesFallbackAnalysis(findings, dependencies);

  const lines: string[] = [
    "# Package Cleanup Suggestions",
    "",
    "## Review before removing",
    "",
  ];

  if (fallbackMode) {
    lines.push(FALLBACK_WARNING);
    lines.push("");
    lines.push(
      "Fallback detector used — confirm package usage before uninstalling. Do not run bulk uninstall commands without manual review."
    );
    lines.push("");
  }

  for (const dep of dependencies) {
    const name = dep.packageName;
    if (!name) continue;

    const confidencePct = Math.round(dep.confidence * 100);
    const fromFallback = dep.source === "knip_fallback" || findings.rawToolReports.knip === "fallback";

    lines.push(`- \`${name}\``);
    lines.push(`  - Reason: ${dep.reason}`);
    if (fromFallback) {
      lines.push(`  - Source: fallback detector (${dep.source})`);
      lines.push(`  - Action: Review before removing — confirm in config, scripts, and dynamic imports`);
    } else {
      lines.push(`  - Source: ${dep.source}`);
    }
    lines.push(`  - Confidence: ${confidencePct}%`);

    if (maySuggestUninstallCommand(dep, fallbackMode)) {
      lines.push(
        `  - After manual confirmation: \`${uninstallCommand(packageManager, name)}\``
      );
    } else {
      lines.push(`  - Uninstall command: withheld — confirm usage before removing`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
