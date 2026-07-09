import type { ClassifiedItem } from "./types";

const EMPTY_PATCH = `# RepoDiet cleanup patch
# No automatic delete operations generated.
# All current findings require review before patching.
`;

export function generateCleanupPatch(safeItems: ClassifiedItem[]): string {
  if (safeItems.length === 0) {
    return EMPTY_PATCH;
  }

  const lines: string[] = [
    "# RepoDiet cleanup patch",
    "# Safe delete commands — review before applying.",
    "# Apply with: git apply repodiet-cleanup.patch  OR run commands manually.",
    "",
    "# Safe delete commands",
  ];

  for (const item of safeItems) {
    lines.push(`git rm ${quotePath(item.path)}`);
  }

  lines.push("");
  lines.push("# Unified diff plan (command-style — file contents not embedded)");
  lines.push("");

  for (const item of safeItems) {
    lines.push(`diff --git a/${item.path} b/${item.path}`);
    lines.push("deleted file mode 100644");
    lines.push(`--- a/${item.path}`);
    lines.push("+++ /dev/null");
    lines.push(`@@ -1,N +0,0 @@`);
    lines.push(`+# Deleted by RepoDiet safe-delete classifier`);
    lines.push(`+# Reason: ${item.reason}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function countPatchLines(patch: string): number {
  return patch.split("\n").filter((line) => line.trim().length > 0).length;
}

function quotePath(filePath: string): string {
  if (/[\s'"\\]/.test(filePath)) {
    return `"${filePath.replace(/"/g, '\\"')}"`;
  }
  return filePath;
}
