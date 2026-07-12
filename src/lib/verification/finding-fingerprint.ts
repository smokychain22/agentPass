import type { Finding } from "@/lib/findings/types";

export function findingFingerprint(finding: Finding): string {
  const files = [...finding.files].sort().join("|");
  const pkg = finding.packageName ?? "";
  const symbol = finding.evidence.signals.find((s) => s.startsWith("symbol="))?.slice(7) ?? "";
  return `${finding.type}:${files}:${pkg}:${symbol}`;
}

export function fingerprintSet(findings: Finding[]): Set<string> {
  return new Set(findings.map(findingFingerprint));
}
