import type { InternalRole } from "./types";

/** Deterministic internal responsibilities — not separate LLM agents. */
export const INTERNAL_ROLES: Record<
  InternalRole,
  { label: string; responsibility: string }
> = {
  orchestrator: {
    label: "Orchestrator",
    responsibility: "Coordinates supported A2A workflows and state transitions.",
  },
  repository_analyzer: {
    label: "Repository Analyzer",
    responsibility: "Runs scanRepository and analyzeRepository via shared engine.",
  },
  safety_classifier: {
    label: "Safety Classifier",
    responsibility: "Applies selectSafeFixes and protected-path rules.",
  },
  fix_executor: {
    label: "Fix Executor",
    responsibility: "Generates deterministic Phase 1 fixes or Patch Kit bundles.",
  },
  verification_worker: {
    label: "Verification Worker",
    responsibility: "Runs baseline and post-change verification checks.",
  },
  github_delivery_worker: {
    label: "GitHub Delivery Worker",
    responsibility: "Creates cleanup branches and pull requests after approval.",
  },
  receipt_signer: {
    label: "Receipt Signer",
    responsibility: "Signs execution receipts when operator key is configured.",
  },
};

export function roleLabel(role: InternalRole): string {
  return INTERNAL_ROLES[role].label;
}
