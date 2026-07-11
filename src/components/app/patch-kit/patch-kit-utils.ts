import { flattenFindings } from "@/lib/findings/client";
import type { FindingsPayload } from "@/lib/findings/types";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import type { PatchKitArtifacts } from "@/lib/patch-kit/types";

export interface SafeDeleteRow {
  file: string;
  reason: string;
  confidence: number | null;
  action: string;
  patchStatus: string;
}

export interface ArtifactDefinition {
  id: string;
  filename: string;
  description: string;
  getContent: (artifacts: PatchKitArtifacts) => string;
  mime: string;
}

export const ARTIFACT_DEFINITIONS: ArtifactDefinition[] = [
  {
    id: "report",
    filename: "repodiet-report.md",
    description: "Executive cleanup report for OKX demo and A2A delivery.",
    getContent: (a) => a.reportMd,
    mime: "text/markdown",
  },
  {
    id: "patch",
    filename: "repodiet-cleanup.patch",
    description: "Conservative safe-delete patch plan — review before applying.",
    getContent: (a) => a.cleanupPatch,
    mime: "text/plain",
  },
  {
    id: "package",
    filename: "package-cleanup.md",
    description: "Dependency removal suggestions from unused package findings.",
    getContent: (a) => a.packageCleanupMd,
    mime: "text/markdown",
  },
  {
    id: "regression",
    filename: "regression-checklist.md",
    description: "Build, lint, route, and API checks after cleanup.",
    getContent: (a) => a.regressionChecklistMd,
    mime: "text/markdown",
  },
  {
    id: "cursor",
    filename: "cursor-prompt.md",
    description: "Ready-to-paste Cursor agent cleanup instructions.",
    getContent: (a) => a.cursorPromptMd,
    mime: "text/markdown",
  },
  {
    id: "findings",
    filename: "findings.json",
    description: "Full findings payload included in the bundle.",
    getContent: (a) => JSON.stringify(a.findingsJson, null, 2),
    mime: "application/json",
  },
];

export function buildSafeDeleteRows(findings: FindingsPayload): SafeDeleteRow[] {
  const buckets = classifyFindingsForPatch(findings);
  const byId = new Map(flattenFindings(findings).map((f) => [f.id, f]));
  const byFile = new Map<string, (typeof byId extends Map<string, infer V> ? V : never)>();

  for (const f of flattenFindings(findings)) {
    for (const file of f.files) {
      if (!byFile.has(file)) byFile.set(file, f);
    }
  }

  return buckets.safeDelete.map((item) => {
    const finding = item.findingId
      ? byId.get(item.findingId)
      : byFile.get(item.path);
    return {
      file: item.path,
      reason: item.reason,
      confidence: finding?.confidence ?? null,
      action: "Safe Candidate",
      patchStatus: "Included in cleanup.patch",
    };
  });
}

export { BUNDLE_FILE_COUNT } from "@/lib/patch-kit/bundle-manifest";
