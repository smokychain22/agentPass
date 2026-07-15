import type { MaintenanceContractRecord } from "../contract";
import type { SignedGreenPrReceipt } from "../receipt";
import { verifyGreenPrReceipt } from "../receipt";
import { validateExecutionScope, type AuthorizedExecutorDispatch } from "./executor";

export type VerificationStatus = "passed" | "failed" | "skipped" | "blocked" | "unknown";

export interface CommandResult {
  command: string;
  status: VerificationStatus;
  diagnostics?: string[];
}

export interface NamedCheckResult {
  name: string;
  status: VerificationStatus;
  url?: string;
}

export interface IndependentVerificationInput {
  contractRecord: MaintenanceContractRecord;
  contractDigest: string;
  repository: string;
  sourceCommit: string;
  patchCommit: string;
  pullRequest: { url: string; number: number; headCommit: string };
  executorDispatch: AuthorizedExecutorDispatch;
  baselineCommands: CommandResult[];
  patchedCommands: CommandResult[];
  baselineDiagnostics: string[];
  patchedDiagnostics: string[];
  githubChecks: NamedCheckResult[];
  providerChecks?: NamedCheckResult[];
  receipt?: SignedGreenPrReceipt;
  trustedReceiptKeys?: Record<string, string>;
  previouslyProcessedReceiptIds?: Set<string>;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  reason?: string;
}

export interface GreenPrVerificationDecision {
  role: "verifier";
  contractDigest: string;
  contractSatisfied: boolean;
  deliveryReady: boolean;
  acceptanceRecommendation: "ACCEPT" | "REJECT" | "OWNER_REVIEW";
  checks: VerificationCheck[];
  newDiagnostics: string[];
  verifiedAt: string;
}

function check(name: string, passed: boolean, reason?: string): VerificationCheck {
  return { name, passed, ...(passed || !reason ? {} : { reason }) };
}

function requiredResultsPass(
  required: string[],
  results: Array<{ name: string; status: VerificationStatus }>,
  allowSkipped: boolean
): { passed: boolean; reason?: string } {
  for (const requiredName of required) {
    const result = results.find((candidate) => candidate.name === requiredName);
    if (!result) return { passed: false, reason: `missing:${requiredName}` };
    if (result.status === "passed") continue;
    if (allowSkipped && result.status === "skipped") continue;
    return { passed: false, reason: `${requiredName}:${result.status}` };
  }
  return { passed: true };
}

export function independentlyVerifyGreenPr(
  input: IndependentVerificationInput,
  now = new Date()
): GreenPrVerificationDecision {
  const contract = input.contractRecord.contract;
  const checks: VerificationCheck[] = [];
  checks.push(check(
    "contract_digest",
    input.contractDigest === input.contractRecord.contractDigest,
    "contract_digest_mismatch"
  ));
  checks.push(check(
    "repository",
    input.repository === `${contract.repository.owner}/${contract.repository.name}`,
    "repository_mismatch"
  ));
  checks.push(check(
    "source_commit",
    input.sourceCommit === contract.repository.sourceCommit &&
      input.executorDispatch.sourceCommit === contract.repository.sourceCommit,
    "source_commit_mismatch"
  ));
  checks.push(check(
    "pr_head",
    Boolean(input.patchCommit) && input.pullRequest.headCommit === input.patchCommit,
    "pull_request_head_mismatch"
  ));
  checks.push(check(
    "pull_request",
    contract.delivery.pullRequestRequired
      ? input.pullRequest.number > 0 && /^https:\/\/github\.com\//.test(input.pullRequest.url)
      : true,
    "pull_request_missing"
  ));

  const scope = validateExecutionScope(input.contractRecord, input.executorDispatch);
  checks.push(check("scope", scope.valid, scope.violations.join(",")));

  const baseline = requiredResultsPass(
    contract.verificationPolicy.requiredCommands,
    input.baselineCommands.map((result) => ({ name: result.command, status: result.status })),
    contract.verificationPolicy.allowSkippedChecks
  );
  checks.push(check(
    "baseline",
    !contract.verificationPolicy.baselineRequired || baseline.passed,
    baseline.reason ?? "baseline_failed"
  ));

  const patched = requiredResultsPass(
    contract.verificationPolicy.requiredCommands,
    input.patchedCommands.map((result) => ({ name: result.command, status: result.status })),
    contract.verificationPolicy.allowSkippedChecks
  );
  checks.push(check("required_commands", patched.passed, patched.reason));

  const github = requiredResultsPass(
    contract.verificationPolicy.requiredGitHubChecks,
    input.githubChecks,
    contract.verificationPolicy.allowSkippedChecks
  );
  checks.push(check("required_github_checks", github.passed, github.reason));

  const baselineDiagnosticSet = new Set(input.baselineDiagnostics);
  const newDiagnostics = [...new Set(input.patchedDiagnostics)]
    .filter((diagnostic) => !baselineDiagnosticSet.has(diagnostic))
    .sort();
  checks.push(check(
    "new_diagnostics",
    contract.verificationPolicy.allowNewDiagnostics || newDiagnostics.length === 0,
    `${newDiagnostics.length}_new_diagnostics`
  ));

  if (contract.acceptancePolicy.receiptMustVerify) {
    if (!input.receipt) {
      checks.push(check("receipt", false, "receipt_missing"));
    } else {
      const receipt = verifyGreenPrReceipt(
        input.receipt,
        input.contractRecord,
        input.trustedReceiptKeys ?? {},
        input.previouslyProcessedReceiptIds ?? new Set()
      );
      checks.push(check("receipt", receipt.valid, receipt.reasons.join(",")));
    }
  }

  const blockingChecksPass = checks.every((entry) => entry.passed);
  return {
    role: "verifier",
    contractDigest: input.contractRecord.contractDigest,
    contractSatisfied: blockingChecksPass,
    deliveryReady: blockingChecksPass,
    acceptanceRecommendation: blockingChecksPass ? "ACCEPT" : "REJECT",
    checks,
    newDiagnostics,
    verifiedAt: now.toISOString(),
  };
}
