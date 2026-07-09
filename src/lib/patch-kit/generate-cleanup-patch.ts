import type { ClassifiedItem } from "./types";

export const EMPTY_CLEANUP_PATCH = `# RepoDiet cleanup patch
No automatic delete operations generated.
Current findings require review before patching.
`;

const DELETE_MARKERS = [
  /^git rm /m,
  /^deleted file mode /m,
  /^diff --git a\/.+ b\/.+$/m,
];

export function generateCleanupPatch(safeItems: ClassifiedItem[]): string {
  if (safeItems.length === 0) {
    return EMPTY_CLEANUP_PATCH;
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

/** Hard guard: never emit delete operations when there are zero safe candidates. */
export function finalizeCleanupPatch(
  safeDeleteCount: number,
  patch: string
): string {
  if (safeDeleteCount === 0) {
    return EMPTY_CLEANUP_PATCH;
  }
  if (DELETE_MARKERS.some((pattern) => pattern.test(patch)) && safeDeleteCount === 0) {
    return EMPTY_CLEANUP_PATCH;
  }
  return patch;
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
