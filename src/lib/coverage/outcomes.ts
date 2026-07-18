export const TERMINAL_COVERAGE_OUTCOMES = [
  "SEMANTICALLY_ANALYZED",
  "STRUCTURALLY_ANALYZED",
  "TEXTUALLY_ANALYZED",
  "METADATA_ANALYZED",
  "BINARY_INSPECTED",
  "GENERATED_CLASSIFIED",
  "VENDORED_CLASSIFIED",
  "PROTECTED_BY_POLICY",
  "UNREADABLE_WITH_REASON",
  "ANALYZER_FAILED_WITH_REASON",
] as const;

export type TerminalCoverageOutcome = (typeof TERMINAL_COVERAGE_OUTCOMES)[number];

/** Runtime enum-like map of every terminal coverage outcome. */
export const TerminalCoverageOutcome = {
  SEMANTICALLY_ANALYZED: "SEMANTICALLY_ANALYZED",
  STRUCTURALLY_ANALYZED: "STRUCTURALLY_ANALYZED",
  TEXTUALLY_ANALYZED: "TEXTUALLY_ANALYZED",
  METADATA_ANALYZED: "METADATA_ANALYZED",
  BINARY_INSPECTED: "BINARY_INSPECTED",
  GENERATED_CLASSIFIED: "GENERATED_CLASSIFIED",
  VENDORED_CLASSIFIED: "VENDORED_CLASSIFIED",
  PROTECTED_BY_POLICY: "PROTECTED_BY_POLICY",
  UNREADABLE_WITH_REASON: "UNREADABLE_WITH_REASON",
  ANALYZER_FAILED_WITH_REASON: "ANALYZER_FAILED_WITH_REASON",
} as const satisfies { [K in TerminalCoverageOutcome]: K };

export const FORBIDDEN_BARE_OUTCOMES = [
  "SKIPPED",
  "IGNORED",
  "UNSUPPORTED",
  "UNKNOWN",
  "EXCLUDED",
] as const;

export type ForbiddenBareOutcome = (typeof FORBIDDEN_BARE_OUTCOMES)[number];

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_COVERAGE_OUTCOMES);
const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_BARE_OUTCOMES);

export function isTerminalCoverageOutcome(
  outcome: string
): outcome is TerminalCoverageOutcome {
  return TERMINAL_SET.has(outcome);
}

export function isForbiddenBareOutcome(outcome: string): boolean {
  return FORBIDDEN_SET.has(outcome);
}

export function assertValidTerminalOutcome(
  outcome: string
): asserts outcome is TerminalCoverageOutcome {
  if (isForbiddenBareOutcome(outcome)) {
    throw new Error(`forbidden_bare_coverage_outcome:${outcome}`);
  }
  if (!isTerminalCoverageOutcome(outcome)) {
    throw new Error(`invalid_terminal_coverage_outcome:${outcome}`);
  }
}
