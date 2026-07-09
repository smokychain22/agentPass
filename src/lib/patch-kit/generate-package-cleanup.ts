import type { Finding } from "@/lib/findings/types";
import type { PackageManager } from "@/lib/scanner/types";

const EMPTY_MD = `# Package Cleanup Suggestions

No dependency removal suggestions were generated.

Reason: no unused dependency findings were available from the current scan.
`;

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

export function generatePackageCleanup(
  dependencies: Finding[],
  packageManager: PackageManager = "npm"
): string {
  if (dependencies.length === 0) {
    return EMPTY_MD;
  }

  const lines: string[] = [
    "# Package Cleanup Suggestions",
    "",
    "## Review before removing",
    "",
  ];

  for (const dep of dependencies) {
    const name = dep.packageName;
    if (!name) continue;

    const confidencePct = Math.round(dep.confidence * 100);
    lines.push(`- \`${name}\``);
    lines.push(`  - Reason: ${dep.reason}`);
    lines.push(`  - Suggested command: ${uninstallCommand(packageManager, name)}`);
    lines.push(`  - Confidence: ${confidencePct}%`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
