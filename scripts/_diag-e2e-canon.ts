import path from "node:path";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { buildMaintenanceOutcome } from "../src/lib/maintenance/outcome";
import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import type { ChangeOperation } from "../src/lib/patch-kit/canonical-patch";
import {
  getCleanupEligibilitySignals,
  riskBucketOf,
} from "../src/lib/findings/cleanup-eligibility";
import { resolvePhase1Plugin } from "../src/lib/execution/fix-plugins/phase1-plugins";
import { isCleanupEligibleAudit } from "../src/lib/execution/candidate-lifecycle";

const E2E_REPO_URL = "https://github.com/smokychain22/repodiet-e2e-test";
const BRANCH = "main";

function flattenFindings(findings: FindingsPayload): Finding[] {
  return [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
}

function signalValue(finding: Finding, prefix: string): string | undefined {
  return finding.evidence.signals.find((signal) => signal.startsWith(prefix))?.slice(prefix.length);
}

function preflightStatus(finding: Finding): string | undefined {
  return signalValue(finding, "preflight=") ?? signalValue(finding, "classification=");
}

function normalizePath(value: string | undefined): string | undefined {
  return value?.replace(/\\/g, "/").replace(/^\.\//, "");
}

function compactOperation(operation: ChangeOperation) {
  return {
    type: operation.type,
    filePath: operation.filePath,
    findingIds: operation.findingIds,
    transformerId: operation.transformerId,
  };
}

function printJson(label: string, value: unknown) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const fixturePath = path.join(process.cwd(), "e2e-fixture");
  process.env.REPODIET_E2E_FIXTURE_PATH = fixturePath;

  console.log("DIAG e2e exact duplicate canonicalization");
  console.log(`cwd=${process.cwd()}`);
  console.log(`REPODIET_E2E_FIXTURE_PATH=${process.env.REPODIET_E2E_FIXTURE_PATH}`);
  console.log(`repoUrl=${E2E_REPO_URL}`);
  console.log(`branch=${BRANCH}`);

  console.log("\nRunning runFindingsEngine like e2e...");
  const findings = await runFindingsEngine(E2E_REPO_URL, BRANCH);
  const flat = flattenFindings(findings);
  const exactDuplicates = findings.duplicates.filter((finding) =>
    finding.evidence.signals.includes("exact_file_duplicate=true")
  );

  printJson("Findings summary", {
    scanId: findings.scanId,
    repo: findings.repo,
    summary: findings.summary,
    riskBuckets: findings.riskBuckets,
    exactDuplicateCount: exactDuplicates.length,
  });

  printJson(
    "Exact duplicate findings",
    exactDuplicates.map((finding) => {
      const eligibility = getCleanupEligibilitySignals(finding);
      const plugin = resolvePhase1Plugin(finding);
      return {
        id: finding.id,
        filePath: finding.files[0],
        files: finding.files,
        category: finding.type,
        riskBucket: eligibility.riskBucket ?? riskBucketOf(finding),
        recommendedAction: finding.suggestedAction ?? finding.action,
        action: finding.action,
        transformerId: plugin.id,
        transformerLabel: plugin.label,
        preflightStatus: preflightStatus(finding),
        cleanupEligibility: {
          isCleanupEligible: eligibility.isCleanupEligible,
          isVerified: eligibility.isVerified,
          transformerAvailable: eligibility.transformerAvailable,
          transformerPreflightPassed: eligibility.transformerPreflightPassed,
          producesRealChange: eligibility.producesRealChange,
          isProtected: eligibility.isProtected,
        },
        evidenceSignals: finding.evidence.signals,
      };
    })
  );

  console.log("\nRunning runPatchKitEngine with e2e args (repoUrl, branch, findings; no selectedFindingIds)...");
  const patchKit = await runPatchKitEngine({
    repoUrl: E2E_REPO_URL,
    branch: BRANCH,
    findings,
  });

  printJson("PatchKit summary", {
    id: patchKit.id,
    scanId: patchKit.scanId,
    summary: patchKit.summary,
    patchValidation: patchKit.patchValidation,
    repositoryVerification: patchKit.repositoryVerification,
    changeManifest: patchKit.changeManifest,
  });

  const operations = patchKit.changeOperations ?? [];
  printJson(
    "Change operations",
    operations.map(compactOperation)
  );

  const audits = patchKit.candidateAudits ?? [];
  const transformerResults = patchKit.transformerResults ?? [];
  printJson(
    "Auto-selection diagnostics",
    {
      e2eSelectedFindingIds: null,
      criteria:
        "No selectedFindingIds were passed. runPatchKitEngine auto-selects eligibleFindingIds from cleanup-eligible preflight audits, excluding red remediation items; if a selected scope exists it intersects that scope.",
      inferredEligibleAuditFindingIds: audits
        .filter((audit) => isCleanupEligibleAudit(audit))
        .map((audit) => audit.findingId),
      inferredExecutedAuditFindingIds: audits
        .filter((audit) => audit.transformAttempted)
        .map((audit) => audit.findingId),
      candidateAuditCount: audits.length,
      transformerResultCount: transformerResults.length,
    }
  );

  const exactDuplicateMatches = exactDuplicates.map((finding) => {
    const duplicatePath = normalizePath(signalValue(finding, "duplicate="));
    const canonicalPath = normalizePath(signalValue(finding, "canonical="));
    const operationsForFinding = operations.filter((operation) =>
      operation.findingIds.includes(finding.id)
    );
    const matchingDelete = operations.find(
      (operation) =>
        operation.type === "delete" &&
        normalizePath(operation.filePath) === duplicatePath &&
        operation.findingIds.includes(finding.id)
    );
    return {
      findingId: finding.id,
      canonicalPath,
      duplicatePath,
      matchingDeleteExists: Boolean(matchingDelete),
      matchingDelete: matchingDelete ? compactOperation(matchingDelete) : null,
      operationsForFinding: operationsForFinding.map(compactOperation),
    };
  });
  printJson("Exact duplicate delete-op match", exactDuplicateMatches);

  const exactIds = new Set(exactDuplicates.map((finding) => finding.id));
  const consolidateAudits = audits.filter(
    (audit) => audit.pluginId === "consolidate_exact_duplicate" || exactIds.has(audit.findingId)
  );
  const consolidateResults = transformerResults.filter((result) => exactIds.has(result.findingId));

  printJson(
    "consolidate_exact_duplicate audits/results",
    {
      audits: consolidateAudits.map((audit) => ({
        findingId: audit.findingId,
        findingType: audit.findingType,
        filePath: audit.filePath,
        pluginId: audit.pluginId,
        strategyIds: audit.strategyIds,
        isCleanupEligibleAudit: isCleanupEligibleAudit(audit),
        scanEligible: audit.scanEligible,
        transformAttempted: audit.transformAttempted,
        contentChanged: audit.contentChanged,
        dryRunSucceeded: audit.dryRunSucceeded,
        proposedSourceChanged: audit.proposedSourceChanged,
        proposedDiffGenerated: audit.proposedDiffGenerated,
        patchValidated: audit.patchValidated,
        retained: audit.retained,
        blockerCode: audit.blockerCode,
        blockerMessage: audit.blockerMessage,
      })),
      transformerResults: consolidateResults,
      noAuditExactDuplicateFindingIds: exactDuplicates
        .filter((finding) => !consolidateAudits.some((audit) => audit.findingId === finding.id))
        .map((finding) => finding.id),
    }
  );

  const outcome = buildMaintenanceOutcome({
    findings,
    changeOperations: operations,
    verificationStatus: patchKit.repositoryVerification?.status ?? patchKit.patchValidation?.status,
  });

  printJson("Maintenance outcome", {
    kind: outcome.kind,
    headline: outcome.headline,
    canonicalizations: outcome.canonicalizations,
    changedPaths: outcome.changedPaths,
    editedPaths: outcome.editedPaths,
    deletedPaths: outcome.deletedPaths,
    addedPaths: outcome.addedPaths,
    verificationStatus: outcome.verificationStatus,
    evidenceStatement: outcome.evidenceStatement,
  });

  printJson(
    "Exact duplicate source rows with matching operation status",
    exactDuplicates.map((finding) => ({
      id: finding.id,
      title: finding.title,
      canonical: signalValue(finding, "canonical="),
      duplicate: signalValue(finding, "duplicate="),
      contentHash: signalValue(finding, "content_hash="),
      preflight: preflightStatus(finding),
      isCleanupEligible: getCleanupEligibilitySignals(finding).isCleanupEligible,
      transformerId: resolvePhase1Plugin(finding).id,
      matchingDeleteExists: exactDuplicateMatches.find((match) => match.findingId === finding.id)
        ?.matchingDeleteExists,
    }))
  );

  printJson(
    "All exact duplicate ids present in flat findings",
    exactDuplicates.map((finding) => ({
      id: finding.id,
      flatIndex: flat.findIndex((item) => item.id === finding.id),
    }))
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
