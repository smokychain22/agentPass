import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { buildConsolidatedPatchFromEdits } from "../src/lib/patch-kit/merge-patches";
import { patchHasApplyableOperations } from "../src/lib/patch-kit/validate-patch";

async function main() {
  const url = process.argv[2] ?? "https://github.com/velz-cmd/repodiet-e2e-test";
  console.log("repo:", url);
  const findings = await runFindingsEngine(url, "main");
  const patchKit = await runPatchKitEngine({ repoUrl: url, branch: "main", findings });

  console.log("generatedChanges:", patchKit.summary.generatedChanges);
  console.log("validatedChanges:", patchKit.summary.validatedChanges);
  console.log("patchValidation:", patchKit.patchValidation?.status, patchKit.patchValidation?.error);
  console.log("changedPaths:", patchKit.summary.changedPaths);
  console.log("deletedPaths:", patchKit.summary.deletedPaths);
  console.log("patch applyable:", patchHasApplyableOperations(patchKit.artifacts.cleanupPatch));
  console.log("patch preview:\n", patchKit.artifacts.cleanupPatch.slice(0, 800));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
