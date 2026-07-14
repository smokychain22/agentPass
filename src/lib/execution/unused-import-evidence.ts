import type { Finding } from "@/lib/findings/types";

const IMPORT_DECLARATION = /^\s*import\s+/;

export interface ValidUnusedImportEvidence {
  importLine: string;
  symbol: string;
  lineNumber?: number;
  filePath: string;
}

export function parseUnusedImportEvidence(
  finding: Finding
): { ok: true; evidence: ValidUnusedImportEvidence } | { ok: false; reason: string } {
  if (finding.type !== "unused_import") {
    return { ok: false, reason: "Not an unused import finding." };
  }
  if (finding.files.length !== 1 || !finding.files[0]) {
    return { ok: false, reason: "Unused import must target exactly one file." };
  }

  const importLineSignal = finding.evidence.signals.find((s) => s.startsWith("importLine="));
  const symbolSignal = finding.evidence.signals.find((s) => s.startsWith("symbol="));
  if (!importLineSignal || !symbolSignal) {
    return { ok: false, reason: "Missing explicit importLine= and symbol= signals." };
  }

  const importLine = importLineSignal.slice("importLine=".length).trim();
  const symbol = symbolSignal.slice("symbol=".length).trim();
  if (!importLine || !symbol) {
    return { ok: false, reason: "importLine= and symbol= must be non-empty." };
  }
  if (!IMPORT_DECLARATION.test(importLine)) {
    return { ok: false, reason: "importLine must begin with a real import declaration." };
  }

  const lineRaw = finding.evidence.signals.find((s) => s.startsWith("line="))?.slice("line=".length);
  const lineNumber = lineRaw ? Number(lineRaw) : undefined;

  return {
    ok: true,
    evidence: {
      importLine,
      symbol,
      lineNumber: Number.isFinite(lineNumber) ? lineNumber : undefined,
      filePath: finding.files[0],
    },
  };
}

export function importEvidenceBlockerReason(finding: Finding): string | undefined {
  const parsed = parseUnusedImportEvidence(finding);
  return parsed.ok ? undefined : parsed.reason;
}
