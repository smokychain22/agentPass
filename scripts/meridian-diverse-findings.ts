import fs from "node:fs";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { toEvidenceStandardFindings, flattenFindings } from "../src/lib/findings/evidence-standard";
import type { Finding } from "../src/lib/findings/types";

async function main() {
  const findings = await runFindingsEngine("https://github.com/velz-cmd/Meridian", "main");
  if (
    ["scan_DymsApC3ZKMJ", "scan_CellDRLCZHAa", "scan_iAJAsIw0HjFg", "scan_GW46u26eOt_o"].includes(
      findings.scanId
    )
  ) {
    throw new Error("historical scan");
  }
  const flat = flattenFindings(findings);
  const evidence = toEvidenceStandardFindings(findings);
  const pick = (pred: (f: Finding) => boolean, n: number) =>
    evidence
      .filter((e) => {
        const o = flat.find((x) => x.id === e.findingId);
        return o ? pred(o) : false;
      })
      .slice(0, n);

  const diverse = [
    ...pick((f) => f.type === "unused_import", 3),
    ...pick((f) => f.type === "unused_dependency", 3),
    ...pick((f) => f.type === "unused_file" && f.action === "safe_candidate", 5),
    ...pick((f) => f.type === "duplicate_code" && f.action !== "do_not_touch", 5),
    ...pick((f) => f.type === "orphan_pattern", 4),
    ...pick((f) => f.type === "unused_export", 3),
    ...pick((f) => f.type === "ai_slop_signal", 2),
  ].map((f) => {
    const o = flat.find((x) => x.id === f.findingId)!;
    return {
      findingId: f.findingId,
      type: f.type,
      classification: f.classification,
      paths: f.paths,
      sourceCommit: "a35631c6748d6619b9301a02b34f2ff99eecd5b7",
      confidenceBasis: "deterministic evidence",
      analyzerSource: o.source,
      sourceMode: o.sourceMode,
      evidence: {
        staticReferences: f.evidence.staticReferences,
        dynamicReferences: f.evidence.dynamicReferences,
        packageScriptReferences: f.evidence.packageScriptReferences,
        configurationReferences: f.evidence.configurationReferences,
        routeReferences: f.evidence.routeReferences,
        testReferences: f.evidence.testReferences,
        publicApiReferences: f.evidence.publicApiReferences,
        entryPoint: f.evidence.entryPoint,
        generated: f.evidence.generated,
        protected: f.evidence.protected,
        whyBelievedRemovable: f.evidence.whyBelievedRemovable,
        whatCouldMakeRemovalUnsafe: f.evidence.whatCouldMakeRemovalUnsafe,
        signals: o.evidence?.signals?.slice(0, 15) ?? [],
      },
      proposedOperations: f.proposedOperations,
      requiredVerification: f.requiredVerification,
      reasonsNotToExecute: f.reasonsNotToExecute,
      packageName: o.packageName,
      dependencySection: o.dependencySection,
      classificationLabel: o.classificationLabel,
    };
  });

  const out = {
    scanId: findings.scanId,
    totals: {
      totalDetected: findings.summary.totalFindings,
      safeCandidates: findings.summary.safeCandidates,
      reviewFirst: findings.summary.reviewRequired,
      protected: findings.summary.doNotTouch,
      transformEligible: findings.summary.eligibleFindings ?? 0,
      verifiedEligible: findings.summary.verifiedFindings ?? 0,
    },
    tools: {
      knip: findings.rawToolReports.knip,
      jscpd: findings.rawToolReports.jscpd,
      madge: findings.rawToolReports.madge,
    },
    diverseStrongest: diverse,
  };
  fs.writeFileSync("/opt/cursor/artifacts/meridian-diverse-findings.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ scanId: findings.scanId, count: diverse.length, types: diverse.map((d) => d.type) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
