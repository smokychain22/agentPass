import type { Finding } from "@/lib/findings/types";

export function findingFingerprint(finding: Finding): string {
  const files = [...finding.files].sort().join("|");
  const pkg = finding.packageName ?? "";
  const symbol = finding.evidence.signals.find((s) => s.startsWith("symbol="))?.slice(7) ?? "";
  return `${finding.type}:${files}:${pkg}:${symbol}`;
}

/** Path/package identity — ignores analyzer-specific type duplication across baseline vs post-patch. */
export function findingPathKey(finding: Finding): string {
  const files = [...finding.files].sort().join("|");
  const pkg = finding.packageName ?? "";
  return `${files}:${pkg}`;
}

export function fingerprintSet(findings: Finding[]): Set<string> {
  return new Set(findings.map(findingFingerprint));
}

export function pathKeySet(findings: Finding[]): Set<string> {
  return new Set(findings.map(findingPathKey).filter((key) => key !== ":"));
}
