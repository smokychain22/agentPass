/**
 * Controlled reproduction of the funded-job cleanup failure, OUTSIDE the
 * autonomous delivery path.
 *
 * Runs the same analysis + patch + verification pipeline that
 * `createCleanupPullRequest` runs, against the same controlled repository and
 * base commit, and prints the full structured failure.
 *
 * It deliberately stops BEFORE delivery: it never opens a branch or PR, never
 * acknowledges, delivers or settles the job, and never touches the customer
 * repository. Nothing here goes near the OKX wallet.
 *
 * Usage (inside the deployed Fly machine):
 *   node_modules/.bin/tsx scripts/reproduce-funded-job-verification.ts
 */
import os from "node:os";
import fsp from "node:fs/promises";
import path from "node:path";

const REPO_URL = "https://github.com/velz-cmd/repodiet-e2e-test";
const BASE_COMMIT = "b890ac4b055e608a7729d442c92bfe1dce573e64";
const APPROVED_PATH = "src/unused/empty-module.ts";

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/** Never let a token or secret reach the transcript. */
function sanitize(text: string): string {
  return text
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "<redacted-github-token>")
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, "$1<redacted>$2")
    .replace(/\b[A-Fa-f0-9]{64}\b/g, (m) => (m === BASE_COMMIT ? m : "<redacted-hex64>"));
}

async function main(): Promise<void> {
  section("environment");
  console.log(`buildCommit: ${process.env.REPODIET_BUILD_COMMIT ?? "(unset)"}`);
  console.log(`cwd: ${process.cwd()}`);
  console.log(`node: ${process.version} ${process.platform}/${process.arch}`);
  console.log(`totalMem: ${(os.totalmem() / 1024 ** 3).toFixed(2)} GiB`);
  console.log(`freeMem: ${(os.freemem() / 1024 ** 3).toFixed(2)} GiB`);
  console.log(`cpus: ${os.cpus().length}`);
  console.log(`tmpdir: ${os.tmpdir()}`);
  console.log(`suspended: ${process.env.REPODIET_SUSPEND_SYSTEM_EVENTS ?? "(unset)"}`);

  section("disk");
  const { execa } = await import("execa");
  const df = await execa("df", ["-h"], { reject: false });
  console.log(sanitize(df.stdout || df.stderr || "(no df output)"));

  section("workspace write permission");
  const runtimeRoot = process.env.REPODIET_OKX_RUNTIME_ROOT ?? os.tmpdir();
  for (const dir of [runtimeRoot, os.tmpdir(), process.cwd()]) {
    try {
      const probe = path.join(dir, `.repodiet-write-probe-${process.pid}`);
      await fsp.writeFile(probe, "probe");
      await fsp.rm(probe, { force: true });
      console.log(`writable: ${dir}`);
    } catch (err) {
      console.log(`NOT writable: ${dir} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  section("findings");
  const { runFindingsEngine } = await import("../src/lib/findings/findings-engine");
  const findings = await runFindingsEngine(REPO_URL, "main");
  console.log(`commitSha: ${findings.repo.commitSha}`);
  console.log(`matchesApprovedBase: ${findings.repo.commitSha === BASE_COMMIT}`);
  console.log(`safeDelete: ${JSON.stringify(findings.riskBuckets?.safeDelete)}`);
  console.log(`scanCoverageWarning: ${findings.scanCoverageWarning ?? "(none)"}`);

  section("patch kit");
  const { runPatchKitEngine } = await import("../src/lib/patch-kit/patch-kit-engine");
  const patchKit = await runPatchKitEngine({
    repoUrl: REPO_URL,
    branch: "main",
    findings,
  } as never);

  const pv = patchKit.patchValidation as Record<string, unknown> | undefined;
  const rv = patchKit.repositoryVerification as Record<string, unknown> | undefined;

  console.log(`generatedChanges: ${patchKit.summary.generatedChanges}`);
  console.log(`validatedChanges: ${patchKit.summary.validatedChanges}`);
  console.log(`verifiedChanges: ${patchKit.summary.verifiedChanges}`);
  console.log(`blockerSummary: ${sanitize(String(patchKit.summary.blockerSummary ?? "(none)"))}`);

  section("patch validation");
  console.log(`status: ${pv?.status}`);
  console.log(`patchGenerationMethod: ${pv?.patchGenerationMethod}`);
  console.log(`gitCliAvailable: ${pv?.gitCliAvailable}`);
  console.log(`validatedPaths: ${JSON.stringify(pv?.validatedPaths)}`);
  console.log(`error: ${sanitize(String(pv?.error ?? "(none)"))}`);

  section("repository verification");
  console.log(`status: ${rv?.status}`);
  console.log(`failureCode: ${rv?.failureCode ?? "(none)"}`);
  console.log(`error: ${sanitize(String(rv?.error ?? "(none)"))}`);

  section("install attempts (command / exit / signal / output)");
  for (const attempt of (rv?.installAttempts as Array<Record<string, unknown>>) ?? []) {
    console.log(`- command: ${attempt.command}`);
    console.log(`  attempt: ${attempt.attempt}  exitCode: ${attempt.exitCode}  durationMs: ${attempt.durationMs}`);
    console.log(`  stdout: ${sanitize(String(attempt.stdout ?? "")).slice(0, 1200)}`);
    console.log(`  stderr: ${sanitize(String(attempt.stderr ?? "")).slice(0, 1200)}`);
  }

  section("verification checks");
  for (const check of (rv?.checks as Array<Record<string, unknown>>) ?? []) {
    console.log(`- ${check.name}: ${check.status} (exit ${check.exitCode}, ${check.durationMs}ms)`);
    console.log(`  command: ${check.command}`);
    const out = sanitize(String(check.stderrSummary || check.stdoutSummary || "")).slice(0, 800);
    if (out) console.log(`  output: ${out}`);
  }

  section("verifiedChanges derivation");
  console.log(`gitValidationPassed (patchValidation.status === "passed"): ${pv?.status === "passed"}`);
  console.log(`repositoryVerification.status === "verified": ${rv?.status === "verified"}`);
  console.log(
    `=> verifiedChanges = ${patchKit.summary.verifiedChanges} (validatedChanges ${patchKit.summary.validatedChanges} gated on verification)`
  );

  section("verification gates");
  const gates = patchKit.verificationGates;
  if (gates) {
    console.log(`allRequiredPassed: ${gates.allRequiredPassed}`);
    for (const gate of gates.gates.filter((g) => g.requiredForSafePr)) {
      const mark = gate.status === "passed" || gate.status === "skipped" ? " " : "X";
      console.log(`  ${mark} ${gate.id}: ${gate.status}${gate.detail ? ` — ${sanitize(gate.detail).slice(0, 200)}` : ""}`);
    }
  } else {
    console.log("(not computed by the engine; createCleanupPullRequest refreshes these)");
  }

  section("candidate operations and rejections");
  console.log(
    `changeOperations: ${JSON.stringify((patchKit.changeOperations ?? []).map((o) => ({ type: o.type, path: o.filePath })))}`
  );
  const { resolveValidatedDeliveryOps } = await import("../src/lib/operator/delivery-operations");
  const { approvedDeletePathsForJob } = await import("../src/lib/okx-runtime/job-delivery-approvals");
  const approvedPaths = approvedDeletePathsForJob({
    jobId: "0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6",
    repositoryUrl: REPO_URL,
    baseCommit: findings.repo.commitSha ?? "",
  });
  console.log(`approvedPaths: ${JSON.stringify(approvedPaths)}`);
  const ops = resolveValidatedDeliveryOps(patchKit, patchKit.validatedEdits ?? [], approvedPaths);
  console.log(`deliverable deletePaths: ${JSON.stringify(ops.deletePaths)}`);
  console.log(`skippedDeletePaths (rejected): ${JSON.stringify(ops.skippedDeletePaths)}`);
  console.log(`approvedPathDeliverable: ${ops.deletePaths.includes(APPROVED_PATH)}`);

  section("done — no branch, PR, delivery or settlement was performed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
