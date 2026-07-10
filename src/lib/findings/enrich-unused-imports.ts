import { nanoid } from "nanoid";
import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import {
  detectUnusedImportsInFile,
  type UnusedImportCandidate,
} from "@/lib/findings/unused-import-detector";
import { clampConfidence, severityForAction } from "@/lib/findings/confidence";

export async function enrichFindingsWithUnusedImports(
  rootDir: string,
  existing: Finding[]
): Promise<Finding[]> {
  const paths = new Set<string>();
  for (const f of existing) {
    for (const file of f.files) {
      if (/\.(tsx?|jsx?)$/.test(file) && !isDoNotTouchPath(file) && !isRouteLikePath(file)) {
        paths.add(file);
      }
    }
  }

  const imports: Finding[] = [];
  for (const rel of paths) {
    const candidates = await detectUnusedImportsInFile(rootDir, rel);
    for (const c of candidates) {
      imports.push(unusedImportFinding(c));
    }
  }
  return imports;
}

function unusedImportFinding(c: UnusedImportCandidate): Finding {
  const action = "safe_candidate" as const;
  return {
    id: `fnd_${nanoid(10)}`,
    type: "unused_import",
    title: `Unused import: ${c.symbol}`,
    files: [c.file],
    confidence: clampConfidence(0.82),
    confidenceReason: "Import symbol not referenced in module body; side-effect imports excluded.",
    severity: severityForAction(action),
    action,
    reason: `Import for "${c.symbol}" is not used in ${c.file}.`,
    source: "heuristic",
    sourceMode: "heuristic",
    evidence: {
      summary: "Deterministic unused import detection",
      signals: [`symbol=${c.symbol}`, `importLine=${c.line}`, `line=${c.lineNumber}`],
    },
  };
}
