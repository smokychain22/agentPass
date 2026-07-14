import type {
  BaselineCheckComparison,
  CheckFailureDiagnosis,
  CheckRunConclusion,
  CleanupCausedDetermination,
  PrCheckRecord,
} from "@/lib/github/pr-check-types";
import { classifyCheckFailure } from "@/lib/workflow/check-failure-classifier";
import { firstActionableLogLine } from "@/lib/github/log-redaction";

function diagnosticFromCheck(
  check?: PrCheckRecord,
  diagnosis?: CheckFailureDiagnosis
): string | undefined {
  return diagnosis?.firstActionableError ?? check?.checkName;
}

function normalizeDiagnostic(text?: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function compareBaselineAndPrChecks(input: {
  baselineChecks: PrCheckRecord[];
  prChecks: PrCheckRecord[];
  baselineDiagnoses: CheckFailureDiagnosis[];
  prDiagnoses: CheckFailureDiagnosis[];
}): BaselineCheckComparison[] {
  const byName = new Map<string, PrCheckRecord>();
  for (const check of [...input.baselineChecks, ...input.prChecks]) {
    byName.set(check.checkName.toLowerCase(), check);
  }

  const comparisons: BaselineCheckComparison[] = [];

  for (const [nameKey, check] of byName) {
    const baseline = input.baselineChecks.find(
      (entry) => entry.checkName.toLowerCase() === nameKey
    );
    const pr = input.prChecks.find((entry) => entry.checkName.toLowerCase() === nameKey);
    const baselineDiagnosis = input.baselineDiagnoses.find(
      (entry) => entry.firstActionableError && baseline?.checkName
    );
    const prDiagnosis = input.prDiagnoses.find((entry) =>
      pr ? entry.firstActionableError.includes(pr.checkName) || true : false
    );

    const baselineDiagnostic = diagnosticFromCheck(baseline, baselineDiagnosis);
    const prDiagnostic = diagnosticFromCheck(pr, prDiagnosis);
    const sameDiagnostic =
      Boolean(baselineDiagnostic && prDiagnostic) &&
      normalizeDiagnostic(baselineDiagnostic) === normalizeDiagnostic(prDiagnostic);

    let cleanupCausedThis: CleanupCausedDetermination = "unknown";
    const baselineFailed = isFailedConclusion(baseline?.conclusion);
    const prFailed = isFailedConclusion(pr?.conclusion);

    if (baselineFailed && prFailed && sameDiagnostic) {
      cleanupCausedThis = false;
    } else if (!baselineFailed && prFailed) {
      cleanupCausedThis = true;
    } else if (baselineFailed && prFailed && !sameDiagnostic) {
      cleanupCausedThis = "unknown";
    } else if (!prFailed) {
      cleanupCausedThis = false;
    }

    comparisons.push({
      checkName: check.checkName,
      baselineConclusion: baseline?.conclusion,
      prConclusion: pr?.conclusion,
      baselineDiagnostic,
      prDiagnostic,
      sameDiagnostic,
      cleanupCausedThis,
    });
  }

  return comparisons;
}

export function isFailedConclusion(conclusion?: CheckRunConclusion): boolean {
  return conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required";
}

export function isTerminalCheck(check: PrCheckRecord): boolean {
  if (check.status !== "completed") return false;
  return check.conclusion !== null;
}

export function isPendingRequiredCheck(check: PrCheckRecord): boolean {
  if (!check.required) return false;
  if (!isTerminalCheck(check)) return true;
  return isFailedConclusion(check.conclusion);
}

export function aggregateCleanupCaused(
  comparisons: BaselineCheckComparison[],
  diagnoses: CheckFailureDiagnosis[]
): CleanupCausedDetermination {
  const failedComparisons = comparisons.filter((entry) => isFailedConclusion(entry.prConclusion));
  if (failedComparisons.length === 0) {
    const failedDiagnoses = diagnoses.filter((entry) => entry.cleanupCausedThis === true);
    if (failedDiagnoses.length > 0) return true;
    return false;
  }
  if (failedComparisons.every((entry) => entry.cleanupCausedThis === false)) return false;
  if (failedComparisons.some((entry) => entry.cleanupCausedThis === true)) return true;
  return "unknown";
}

export function diagnoseChecks(input: {
  failedChecks: PrCheckRecord[];
  evidenceByCheck: Record<
    string,
    {
      outputTitle?: string;
      outputSummary?: string;
      outputText?: string;
      logExcerpt?: string;
      logsAvailable?: boolean;
      cleanupCausedThis?: CleanupCausedDetermination;
    }
  >;
}): CheckFailureDiagnosis[] {
  return input.failedChecks.map((check) => {
    const evidence = input.evidenceByCheck[check.checkName] ?? {};
    return classifyCheckFailure({
      checkName: check.checkName,
      provider: check.provider,
      outputTitle: evidence.outputTitle,
      outputSummary: evidence.outputSummary,
      outputText: evidence.outputText,
      logExcerpt: evidence.logExcerpt,
      logsAvailable: evidence.logsAvailable,
      cleanupCausedThis: evidence.cleanupCausedThis,
    });
  });
}

export function extractCheckDiagnostic(summary?: string, text?: string): string | undefined {
  return firstActionableLogLine([summary, text].filter(Boolean).join("\n"));
}
