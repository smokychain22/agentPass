import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { findingFingerprint } from "@/lib/verification/finding-fingerprint";

export interface SarifResult {
  ruleId: string;
  level: "note" | "warning" | "error";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine?: number; endLine?: number };
    };
  }>;
  properties?: Record<string, unknown>;
}

export interface SarifLog {
  version: string;
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        rules: Array<{ id: string; name: string; shortDescription: { text: string } }>;
      };
    };
    results: SarifResult[];
  }>;
}

function sarifLevel(finding: Finding): SarifResult["level"] {
  if (finding.action === "do_not_touch") return "note";
  if (finding.severity === "high") return "error";
  return "warning";
}

export function findingToSarifResult(finding: Finding): SarifResult {
  const file = finding.files[0] ?? finding.packageName ?? "unknown";
  return {
    ruleId: `repodiet/${finding.type}`,
    level: sarifLevel(finding),
    message: { text: finding.reason || finding.title },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: file },
          region: finding.lines
            ? { startLine: finding.lines.start, endLine: finding.lines.end }
            : undefined,
        },
      },
    ],
    properties: {
      finding_id: finding.id,
      fingerprint: findingFingerprint(finding),
      analyzer: finding.source,
      source_mode: finding.sourceMode,
      confidence: finding.confidence,
      confidence_tier: finding.confidenceTier,
      action: finding.action,
      priority_score: finding.priorityScore,
      evidence_grade: finding.evidenceBundle?.grade ?? finding.evidenceGrade,
      remediation_class: finding.evidenceGate?.confidenceTier,
    },
  };
}

export function findingsPayloadToSarif(payload: FindingsPayload): SarifLog {
  const flat = [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];

  const ruleIds = new Set(flat.map((f) => f.type));
  const rules = [...ruleIds].map((type) => ({
    id: `repodiet/${type}`,
    name: type,
    shortDescription: { text: `RepoDiet ${type.replace(/_/g, " ")}` },
  }));

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "RepoDiet",
            version: "1.0.0",
            rules,
          },
        },
        results: flat.map(findingToSarifResult),
      },
    ],
  };
}
