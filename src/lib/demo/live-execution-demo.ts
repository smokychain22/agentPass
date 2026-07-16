/**
 * Typed demo fixture for the homepage Live Execution Engine.
 * Demonstration data only — never mixed with production APIs.
 */

export type FindingSeverity = "safe" | "review" | "protected" | "analysis";

export type DemoFinding = {
  id: string;
  path: string;
  category: string;
  severity: FindingSeverity;
  selected: boolean;
  evidence: string[];
};

export type PipelineStageId =
  | "analyze"
  | "contract"
  | "execute"
  | "verify"
  | "deliver";

export type DemoCheck = {
  id: string;
  label: string;
  original: string;
  patched: string;
};

export const LIVE_EXECUTION_DEMO = {
  label: "DEMO DATA",
  liveBadge: "LIVE DEMO",
  engineTitle: "RepoDiet Live Execution Engine",
  contractId: "RD-CONTRACT-2048",
  maintenanceLabel: "Repository maintenance contract #RD-2048",
  repository: {
    fullName: "acme/platform",
    branch: "main",
    sourceCommit: "8c21f4a",
    projectRoot: "apps/web",
    filesAnalyzed: 214,
  },
  findings: [
    {
      id: "f1",
      path: "ButtonLegacy.tsx",
      category: "Duplicate implementation",
      severity: "safe",
      selected: true,
      evidence: [
        "0 static references",
        "0 dynamic references",
        "Not an entrypoint",
        "Protected-path check passed",
      ],
    },
    {
      id: "f2",
      path: "archive/dashboard-old.tsx",
      category: "No supported references",
      severity: "safe",
      selected: true,
      evidence: [
        "0 static references",
        "0 dynamic references",
        "Not an entrypoint",
        "Protected-path check passed",
      ],
    },
    {
      id: "f3",
      path: "lodash",
      category: "Unused dependency",
      severity: "review",
      selected: false,
      evidence: [
        "Declared in package.json",
        "No import graph matches",
        "Review-first: structural decision",
      ],
    },
    {
      id: "f4",
      path: "lib/session.ts",
      category: "Protected authentication path",
      severity: "protected",
      selected: false,
      evidence: [
        "Matches protected path auth/**",
        "Excluded from autonomous changes",
      ],
    },
    {
      id: "f5",
      path: "temp-debug.ts",
      category: "Temporary artifact",
      severity: "safe",
      selected: true,
      evidence: [
        "Temp/debug naming pattern",
        "0 static references",
        "Protected-path check passed",
      ],
    },
  ] satisfies DemoFinding[],
  contract: {
    selectedFindings: 3,
    allowedPaths: ["src/components/**", "temp-debug.ts"],
    protectedPaths: ["auth/**", ".env*", "migrations/**"],
    changeBudget: { files: 4, lines: 120 },
  },
  execution: {
    diffs: [
      {
        kind: "modify" as const,
        path: "src/components/Button.tsx",
        before: 'import { legacyHelper } from "./legacy"',
        after: 'import { helper } from "./helper"',
      },
      {
        kind: "delete" as const,
        path: "temp-debug.ts",
        before: "temporary debug artifact",
        after: null,
      },
      {
        kind: "dependency" as const,
        path: "package.json",
        before: "lodash",
        after: null,
      },
    ],
    progress: [
      "Creating isolated branch",
      "Applying approved changes",
      "Checking path budget",
      "Checking change budget",
    ],
  },
  twinBuild: {
    title: "Twin Build Proof",
    checks: [
      { id: "install", label: "Install", original: "passed", patched: "passed" },
      { id: "build", label: "Build", original: "passed", patched: "passed" },
      { id: "typecheck", label: "Typecheck", original: "passed", patched: "passed" },
      { id: "tests", label: "Tests", original: "148 passed", patched: "148 passed" },
    ] satisfies DemoCheck[],
    summary: {
      newDiagnostics: 0,
      publicSurfaceChanges: 0,
      scopeEscapes: 0,
      result: "NO NEW FAILURES",
    },
  },
  delivery: {
    title: "GREEN PR READY",
    prNumber: "#418",
    changedFiles: 3,
    removedLines: 184,
    requiredChecks: "7/7",
    contract: "Satisfied",
    attestation: "Verified",
    receipt: "Signed",
    recommendation: "ACCEPT",
  },
  pipeline: [
    { id: "analyze", label: "Analyze", number: "01" },
    { id: "contract", label: "Contract", number: "02" },
    { id: "execute", label: "Execute", number: "03" },
    { id: "verify", label: "Verify", number: "04" },
    { id: "deliver", label: "Deliver", number: "05" },
  ] as const satisfies ReadonlyArray<{
    id: PipelineStageId;
    label: string;
    number: string;
  }>,
} as const;

/** Sequence stages for the 14–18s loop (index → duration ms). */
export const LIVE_SEQUENCE_TIMINGS = [
  { stage: "connect" as const, ms: 1800 },
  { stage: "findings" as const, ms: 2800 },
  { stage: "contract" as const, ms: 2000 },
  { stage: "execute" as const, ms: 2500 },
  { stage: "verify" as const, ms: 3000 },
  { stage: "deliver" as const, ms: 2500 },
  { stage: "pause" as const, ms: 1500 },
] as const;

export type LiveSequenceStage = (typeof LIVE_SEQUENCE_TIMINGS)[number]["stage"];

export const LIVE_SEQUENCE_TOTAL_MS = LIVE_SEQUENCE_TIMINGS.reduce(
  (sum, entry) => sum + entry.ms,
  0
);

export function sequenceIndexAt(elapsedMs: number): number {
  let cursor = 0;
  for (let i = 0; i < LIVE_SEQUENCE_TIMINGS.length; i += 1) {
    cursor += LIVE_SEQUENCE_TIMINGS[i].ms;
    if (elapsedMs < cursor) return i;
  }
  return LIVE_SEQUENCE_TIMINGS.length - 1;
}

export function pipelineStageForSequence(
  sequenceStage: LiveSequenceStage
): PipelineStageId {
  switch (sequenceStage) {
    case "connect":
    case "findings":
      return "analyze";
    case "contract":
      return "contract";
    case "execute":
      return "execute";
    case "verify":
      return "verify";
    case "deliver":
    case "pause":
      return "deliver";
    default:
      return "analyze";
  }
}
