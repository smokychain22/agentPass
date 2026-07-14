import type { PatchKitPayload } from "./types";
import type { FindingsPayload } from "@/lib/findings/types";

export type BuildGateClassification =
  | "baseline_failure"
  | "patch_regression"
  | "infrastructure_failure"
  | "passed";

export function classifyBuildGateFailure(patchKit: PatchKitPayload): {
  classification: BuildGateClassification;
  check: string;
  commitSha?: string;
  stderrExcerpt?: string;
  fullLog?: string;
} {
  const repoVerification = patchKit.repositoryVerification;
  const status = repoVerification?.status;
  const patched = repoVerification?.patched as { checks?: Array<{ name: string; status: string; stderr?: string }> } | undefined;
  const baseline = repoVerification?.baseline as { checks?: Array<{ name: string; status: string; stderr?: string }> } | undefined;
  const buildCheck =
    patched?.checks?.find((c) => c.name === "build") ??
    baseline?.checks?.find((c) => c.name === "build");
  const stderr = buildCheck?.stderr ?? repoVerification?.error ?? patchKit.patchValidation?.error ?? "";

  if (status === "verified") {
    return { classification: "passed", check: "npm run build" };
  }

  if (repoVerification?.failureCode === "DEPENDENCY_INSTALL_FAILED") {
    return {
      classification: "infrastructure_failure",
      check: "dependency install",
      commitSha: findings?.repo.commitSha,
      stderrExcerpt: stderr.slice(0, 400),
      fullLog: stderr,
    };
  }

  if (status === "regression_failed" || status === "failed") {
    return {
      classification: "patch_regression",
      check: "npm run build",
      commitSha: findings?.repo.commitSha,
      stderrExcerpt: stderr.slice(0, 400),
      fullLog: stderr,
    };
  }

  return {
    classification: "baseline_failure",
    check: "npm run build",
    commitSha: findings?.repo.commitSha,
    stderrExcerpt: stderr.slice(0, 400),
    fullLog: stderr,
  };
}

export function formatBuildGateFailureMessage(
  patchKit: PatchKitPayload,
  findings?: FindingsPayload
): string {
  const info = classifyBuildGateFailure(patchKit);
  if (info.classification === "passed") return "Production build passed.";

  const lines = [
    "Production build failed",
    `Source commit: ${info.commitSha ?? findings?.repo.commitSha ?? "unknown"}`,
    `Check: ${info.check}`,
    `Classification: ${info.classification.replace(/_/g, " ")}`,
  ];

  if (info.stderrExcerpt?.trim()) {
    lines.push("", "Stderr (excerpt):", info.stderrExcerpt.trim());
  }

  if (
    info.classification === "baseline_failure" &&
    info.stderrExcerpt &&
    /syntax|unexpected token|parse/i.test(info.stderrExcerpt)
  ) {
    lines.push(
      "",
      "The selected source commit already contains malformed TypeScript introduced by an earlier cleanup PR. Repair the source repository and run a new scan."
    );
  }

  return lines.join("\n");
}
