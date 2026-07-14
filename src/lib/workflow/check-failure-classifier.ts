import type {
  CheckFailureClassification,
  CheckFailureDiagnosis,
  CheckProvider,
  CleanupCausedDetermination,
} from "@/lib/github/pr-check-types";
import { firstActionableLogLine, redactSensitiveLogExcerpt } from "@/lib/github/log-redaction";

export interface ClassifyCheckFailureInput {
  checkName: string;
  provider: CheckProvider;
  outputTitle?: string;
  outputSummary?: string;
  outputText?: string;
  logExcerpt?: string;
  cleanupCausedThis?: CleanupCausedDetermination;
  logsAvailable?: boolean;
}

function combinedEvidence(input: ClassifyCheckFailureInput): string {
  return [input.outputTitle, input.outputSummary, input.outputText, input.logExcerpt]
    .filter(Boolean)
    .join("\n");
}

export function classifyCheckFailure(
  input: ClassifyCheckFailureInput
): CheckFailureDiagnosis {
  const evidence = combinedEvidence(input);
  const firstLine =
    firstActionableLogLine(evidence) ??
    redactSensitiveLogExcerpt(input.outputSummary ?? input.outputTitle ?? "Check failed.", 280);

  let classification: CheckFailureClassification = "unknown_failure";
  let confidence: "high" | "medium" | "low" = "low";
  let recommendedAction =
    "Review the provider logs for this check and confirm repository deployment settings.";

  if (/environment variable|process\.env\.|ENV .* (not set|missing|undefined)/i.test(evidence)) {
    classification = /invalid|malformed|unexpected value/i.test(evidence)
      ? "invalid_environment_variable"
      : "missing_environment_variable";
    confidence = "high";
    recommendedAction =
      "Add or correct the missing environment variable in your deployment provider settings. RepoDiet cannot modify provider secrets automatically.";
  } else if (/root directory|could not find (a )?package\.json|wrong directory/i.test(evidence)) {
    classification = "wrong_root_directory";
    confidence = "high";
    recommendedAction =
      "Set the correct root directory in your Vercel or CI project settings to match this repository layout.";
  } else if (/build command|npm run build|next build|command ".*" not found/i.test(evidence)) {
    classification = /framework|next\.config|vite\.config/i.test(evidence)
      ? "wrong_framework_configuration"
      : "wrong_build_command";
    confidence = "medium";
    recommendedAction =
      "Review the provider build command and framework preset for this repository.";
  } else if (/npm ERR|ENOTFOUND|cannot find module|ERESOLVE|dependency/i.test(evidence)) {
    classification = "dependency_failure";
    confidence = "medium";
    recommendedAction =
      "Verify dependency installation succeeds in the provider environment. This may be unrelated to RepoDiet cleanup changes.";
  } else if (/403|401|permission denied|not authorized|access denied/i.test(evidence)) {
    classification = "permission_failure";
    confidence = "high";
    recommendedAction =
      "Confirm the deployment provider integration has permission to build and deploy this repository.";
  } else if (/deployment protection|preview restricted|protected branch|not allowed to deploy/i.test(evidence)) {
    classification = "preview_deployment_restricted";
    confidence = "high";
    recommendedAction =
      "Review deployment protection rules in your provider. RepoDiet cannot change deployment protection automatically.";
  } else if (/rate limit|timeout|ETIMEDOUT|503|502|service unavailable/i.test(evidence)) {
    classification = /infrastructure|network|dns/i.test(evidence)
      ? "infrastructure_failure"
      : "external_service_failure";
    confidence = "medium";
    recommendedAction = "Retry the failed check. If the failure persists, inspect provider status and integration health.";
  } else if (/Type error|Failed to compile|SyntaxError/i.test(evidence)) {
    classification =
      input.cleanupCausedThis === true
        ? "cleanup_regression"
        : input.cleanupCausedThis === false
          ? "pre_existing_source_failure"
          : "unknown_failure";
    confidence = input.cleanupCausedThis === "unknown" ? "low" : "high";
    recommendedAction =
      input.cleanupCausedThis === true
        ? "RepoDiet introduced a new source error. Request an expanded repair or reject this cleanup PR."
        : input.cleanupCausedThis === false
          ? "This source error already existed on the default branch. Repair the repository baseline before merging cleanup."
          : "Compare default-branch and PR diagnostics to determine whether RepoDiet caused this failure.";
  } else if (/configuration|project settings|integration/i.test(evidence)) {
    classification = "provider_configuration_error";
    confidence = "medium";
    recommendedAction =
      "Review connected provider project settings. RepoDiet will not modify provider integrations automatically.";
  }

  const affectedFile =
    evidence.match(/(?:\.\/)?(src\/[^\s:]+\.[a-z]+):\d+/i)?.[1] ??
    evidence.match(/(src\/[^\s:]+\.[a-z]+)/i)?.[1];

  return {
    classification,
    cleanupCausedThis: input.cleanupCausedThis ?? "unknown",
    confidence,
    firstActionableError: firstLine,
    affectedFile,
    recommendedAction,
    logExcerpt: input.logExcerpt ? redactSensitiveLogExcerpt(input.logExcerpt, 600) : undefined,
    logsAvailable: input.logsAvailable ?? Boolean(input.logExcerpt),
    providerLogsStatus: input.logsAvailable === false ? "provider_logs_unavailable" : "available",
  };
}
