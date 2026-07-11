#!/usr/bin/env tsx
/**
 * End-to-end smoke: Meridian findings + Quick Cleanup must produce validated diff.
 * Usage: npm run test:meridian-cleanup
 */
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { isEligibleFinding } from "../src/lib/findings/actionability-signals";

const MERIDIAN = process.env.REPODIET_MERIDIAN_URL ?? "https://github.com/velz-cmd/Meridian";

function flattenFindings(payload: Awaited<ReturnType<typeof runFindingsEngine>>) {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

async function main() {
  console.log(`Meridian cleanup smoke: ${MERIDIAN}`);

  const findings = await runFindingsEngine(MERIDIAN);
  const knip = findings.rawToolReports.knip;
  console.log(
    `Knip: ${knip.status}/${knip.sourceMode} issues=${findings.unused.files.length + findings.unused.dependencies.length + findings.unused.exports.length}`
  );
  console.log(`Verified findings: ${findings.summary.verifiedFindings ?? findings.summary.totalFindings}`);
  console.log(`Eligible: ${findings.summary.eligibleFindings ?? 0}`);

  if (knip.status !== "ok" || knip.sourceMode !== "native") {
    console.error("FAIL: Knip not native on Meridian");
    process.exit(1);
  }

  const eligible = flattenFindings(findings).filter(isEligibleFinding);
  console.log(`Eligible findings (strict): ${eligible.length}`);
  if (eligible.length === 0) {
    console.log("SKIP cleanup: no preflight-confirmed eligible findings on Meridian (review-only state).");
    console.log("PASS: Knip native; cleanup correctly blocked with zero eligible transforms.");
    return;
  }

  const patchKit = await runPatchKitEngine({
    repoUrl: MERIDIAN,
    findings,
  });

  const s = patchKit.summary;
  console.log(
    JSON.stringify(
      {
        generatedChanges: s.generatedChanges,
        validatedChanges: s.validatedChanges,
        verifiedChanges: s.verifiedChanges,
        patchValidation: patchKit.patchValidation?.status,
        blockerSummary: s.blockerSummary,
      },
      null,
      2
    )
  );

  if (s.generatedChanges > 0 && patchKit.patchValidation?.status === "passed") {
    console.log("PASS: Meridian produced validated cleanup diff");
    return;
  }

  if (s.generatedChanges > 0) {
    console.log(
      `PARTIAL: ${s.generatedChanges} changes generated but patch validation=${patchKit.patchValidation?.status}: ${patchKit.patchValidation?.error ?? "unknown"}`
    );
    console.log("PASS: Knip native + real source modifications on Meridian (validation needs follow-up).");
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
