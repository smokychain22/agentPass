import { createHash } from "node:crypto";
import type { Finding, FindingsPayload } from "@/lib/findings/types";

export function findingFingerprint(finding: Finding): string {
  const files = [...finding.files].sort().join("|");
  const pkg = finding.packageName ?? "";
  const body = `${finding.type}:${files}:${pkg}`;
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function findingEvidenceHash(finding: Finding): string {
  const signals = [...finding.evidence.signals].sort().join("|");
  const body = `${findingFingerprint(finding)}:${finding.evidence.summary}:${signals}`;
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function collectAllFindings(payload: FindingsPayload): Finding[] {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

export function indexFindingsByFingerprint(findings: Finding[]): Map<string, Finding> {
  const map = new Map<string, Finding>();
  for (const f of findings) {
    map.set(findingFingerprint(f), f);
  }
  return map;
}
