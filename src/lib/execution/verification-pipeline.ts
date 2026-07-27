import { nanoid } from "nanoid";
import type { Finding } from "@/lib/findings/types";
import { countInboundReferences, findFilesImporting } from "./reference-graph";

export interface BoundedVerificationOutcome {
  verificationId: string;
  checkType: "reference_search";
  command: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  result: "passed" | "failed";
  resultSummary: string;
}

const MAX_SUMMARY_LENGTH = 2000;

/**
 * Command 3E, Part 6 — bounded automated verification. Re-searches the
 * actual repository content (static and dynamic import references) for a
 * single finding's file, rather than trusting the scan-time analyzer alone.
 * Real command, real result — never fabricated.
 */
export async function runBoundedReferenceVerification(
  finding: Finding,
  workspace: { rootDir: string }
): Promise<BoundedVerificationOutcome> {
  const startedAt = new Date().toISOString();
  const targetFile = finding.files[0];

  if (!targetFile) {
    return {
      verificationId: `ver_${nanoid(10)}`,
      checkType: "reference_search",
      command: "countInboundReferences()",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: 1,
      result: "failed",
      resultSummary: "No file path on this finding — verification cannot run.",
    };
  }

  const command = `countInboundReferences(rootDir, "${targetFile}")`;
  const inboundCount = await countInboundReferences(workspace.rootDir, targetFile);
  const importers = inboundCount > 0 ? await findFilesImporting(workspace.rootDir, targetFile) : [];
  const completedAt = new Date().toISOString();
  const passed = inboundCount === 0;

  const resultSummary = passed
    ? `No inbound static or dynamic import references found for ${targetFile}.`
    : `Found ${inboundCount} inbound reference(s) to ${targetFile} from: ${importers
        .map((i) => i.file)
        .join(", ")}`.slice(0, MAX_SUMMARY_LENGTH);

  return {
    verificationId: `ver_${nanoid(10)}`,
    checkType: "reference_search",
    command,
    startedAt,
    completedAt,
    exitCode: passed ? 0 : 1,
    result: passed ? "passed" : "failed",
    resultSummary,
  };
}
