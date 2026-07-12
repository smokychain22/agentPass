import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { executeRepositoryCleanupLocal } from "../src/lib/execution/repository-executor";

async function main() {
  const url = "https://github.com/velz-cmd/repodiet-e2e-test";
  const findings = await runFindingsEngine(url, "main");
  const patchKit = await runPatchKitEngine({ repoUrl: url, branch: "main", findings });

  console.log("commit", findings.repo.commitSha);
  console.log("generated", patchKit.summary.generatedChanges);
  console.log("contentValidated", patchKit.summary.contentValidatedOperations);
  console.log("patchStatus", patchKit.patchValidation?.status);
  console.log("changeOps", patchKit.changeOperations?.map((o) => o.filePath));

  const edits =
    patchKit.validatedEdits ??
    patchKit.changeOperations?.map((op) => ({
      path: op.filePath,
      content: op.type === "delete" ? "" : "",
    })) ??
    [];

  if (!findings.repo.commitSha || !patchKit.changeOperations?.length) {
    console.log("missing data, abort");
    return;
  }

  const result = await executeRepositoryCleanupLocal({
    cleanupRunId: patchKit.id,
    scanId: findings.scanId,
    repositoryOwner: findings.repo.owner,
    repositoryName: findings.repo.name,
    branch: findings.repo.branch,
    baseCommitSha: findings.repo.commitSha,
    repoUrl: url,
    edits,
    changeOperations: patchKit.changeOperations,
    patch: patchKit.artifacts.cleanupPatch,
  });

  console.log("local patchValidation", result.patchValidation.status);
  console.log("local patch error", result.patchValidation.error?.slice(0, 300));
  console.log("local repoVerification", result.repositoryVerification.status);
  console.log("local verify error", result.repositoryVerification.error?.slice(0, 300));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
