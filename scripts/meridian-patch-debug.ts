#!/usr/bin/env tsx
import path from "node:path";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";

const MERIDIAN = "https://github.com/velz-cmd/Meridian";

async function main() {
  console.log(`Meridian patch-kit full run: ${MERIDIAN}`);
  const findings = await runFindingsEngine(MERIDIAN);
  const patchKit = await runPatchKitEngine({ repoUrl: MERIDIAN, findings });
  const s = patchKit.summary;

  console.log(
    JSON.stringify(
      {
        generatedChanges: s.generatedChanges,
        validatedChanges: s.validatedChanges,
        verifiedChanges: s.verifiedChanges,
        validatedEdits: patchKit.validatedEdits?.length ?? 0,
        patchValidation: patchKit.patchValidation?.status,
        blockerSummary: s.blockerSummary,
      },
      null,
      2
    )
  );

  if (s.validatedChanges > 0 && patchKit.patchValidation?.status === "passed") {
    console.log("PASS: Meridian Quick Cleanup ready for PR delivery");
    return;
  }

  console.error("FAIL:", patchKit.patchValidation?.error ?? s.blockerSummary);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
