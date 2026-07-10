import { BUNDLE_ARTIFACT_FILES } from "@/lib/patch-kit/bundle-manifest";
import { TOOL_MANIFEST_ENTRIES } from "@/lib/a2mcp/tool-manifest";
import { buildDemoTerminalLines, getDemoScanStats } from "@/lib/demo/terminal-lines";

export const TRUST_POINTS = [
  "Public repositories only",
  "No repository mutation",
  "Review-first cleanup",
] as const;

export const TRUST_LINE = TRUST_POINTS.join(" · ");

export const FOOTER_OKX_COPY =
  "RepoDiet is also available as an A2MCP-ready Software Utility for agent workflows.";

export const A2MCP_READINESS_COPY =
  "RepoDiet endpoints are A2MCP-ready deterministic JSON tools. Payment/x402 enforcement can be added at the OKX listing or gateway layer. Public demo endpoints are open for hackathon review.";

export const DEMO_TERMINAL_LINES = buildDemoTerminalLines();
export const DEMO_SCAN_STATS = getDemoScanStats();

export const HERO = {
  badge: "REPOSITORY INTELLIGENCE",
  headline: "Your AI-built repo is getting heavier every commit.",
  subheadline:
    "RepoDiet scans JavaScript and TypeScript repositories for duplicate logic, dead files, dependency drift, orphan modules, and AI-generated code debt—then creates a conservative cleanup bundle your team can review before merging.",
};

export const SITE_TAGLINES = {
  debt: "AI code creates cleanup debt. RepoDiet turns it into a review-ready patch bundle.",
  positioning:
    "Not auto-clean. Not a linter. A conservative cleanup workflow for AI-built repos.",
  workflow: "Scan the repo. Map the risk. Generate the bundle. Verify before merging.",
  safety:
    "RepoDiet protects routes, configs, env files, lockfiles, and public assets by default.",
  audience: "Built for teams and solo builders using AI coding tools every day.",
};

export const PROBLEM_SECTION = {
  eyebrow: "The cleanup debt",
  title: "AI helps you ship. It also leaves cleanup debt.",
};

export const PROBLEM_CARDS = [
  {
    category: "Debt",
    title: "Duplicate Logic",
    description: "AI creates new files instead of refactoring old ones.",
    size: "large" as const,
    signal: `${DEMO_SCAN_STATS.duplicateClusters} clusters`,
    paths: ["Button.tsx", "ButtonCopy.tsx", "ButtonFinal.tsx"],
    risk: "review" as const,
  },
  {
    category: "Debt",
    title: "Dead Files",
    description: "Old screens, backup folders, and unused components stay behind.",
    size: "medium" as const,
    signal: `${DEMO_SCAN_STATS.unusedFiles} unused`,
    paths: ["archive/OldDashboard.tsx", "backup/GeneratedCardCopy.tsx"],
    risk: "safe" as const,
  },
  {
    category: "Debt",
    title: "Dependency Drift",
    description: "Packages get installed for experiments and never removed.",
    size: "medium" as const,
    signal: `${DEMO_SCAN_STATS.unusedDependencies} packages`,
    paths: ["lodash", "moment", "unused-ui-kit"],
    risk: "review" as const,
  },
  {
    category: "Debt",
    title: "Orphan Modules",
    description: "Utilities and routes become disconnected from the real app flow.",
    size: "medium" as const,
    signal: `${DEMO_SCAN_STATS.orphanPatterns} orphan route`,
    paths: ["lib/utils-old.ts", "app/api/old-execute"],
    risk: "danger" as const,
  },
  {
    category: "Risk",
    title: "Fragile Cleanup Risk",
    description: "Deleting the wrong file can break routes, APIs, or builds.",
    size: "large" as const,
    signal: `${DEMO_SCAN_STATS.doNotTouch} protected`,
    paths: ["routes/", "env files", "lockfiles"],
    risk: "protected" as const,
  },
];

export const WORKFLOW_STEPS = [
  {
    id: "ingest",
    step: "01",
    title: "INGEST",
    subtitle: "Repository connected",
    meta: "Public GitHub URL · branch resolved",
    accent: "muted" as const,
  },
  {
    id: "understand",
    step: "02",
    title: "UNDERSTAND",
    subtitle: "Framework and dependency graph",
    meta: `${DEMO_SCAN_STATS.framework} · ${DEMO_SCAN_STATS.filesIndexed} files indexed`,
    accent: "electric" as const,
  },
  {
    id: "classify",
    step: "03",
    title: "CLASSIFY",
    subtitle: "Safe, Review, Protected",
    meta: `${DEMO_SCAN_STATS.safeCandidates} safe · ${DEMO_SCAN_STATS.reviewFirst} review`,
    accent: "signal" as const,
  },
  {
    id: "package",
    step: "04",
    title: "PACKAGE",
    subtitle: "Patch, report, regression plan",
    meta: "7 artifacts · conservative patch",
    accent: "electric" as const,
  },
  {
    id: "verify",
    step: "05",
    title: "VERIFY",
    subtitle: "Build, lint, routes",
    meta: "Regression checklist prepared",
    accent: "signal" as const,
  },
];

/** @deprecated Use WORKFLOW_STEPS */
export const PIPELINE_STEPS = WORKFLOW_STEPS.map((s) => ({
  id: s.id,
  title: s.title,
  chips: [s.subtitle],
  accent: s.accent,
}));

export const TRANSFORMATION_SECTION = {
  eyebrow: "Transformation",
  title: "Watch repository debt become a safe cleanup plan.",
};

export const TRANSFORMATION_BEFORE_TREE = [
  "repo/",
  "├── Button.tsx",
  "├── ButtonCopy.tsx",
  "├── ButtonFinal.tsx",
  "├── OldDashboard.tsx",
  "├── legacy-api/",
  "└── lodash",
] as const;

export const TRANSFORMATION_BEFORE_LABELS = [
  { path: "ButtonCopy.tsx", label: "duplicate", level: "review" as const },
  { path: "ButtonFinal.tsx", label: "duplicate", level: "review" as const },
  { path: "OldDashboard.tsx", label: "unused", level: "safe" as const },
  { path: "legacy-api/", label: "orphan", level: "danger" as const },
  { path: "lodash", label: "drift", level: "review" as const },
] as const;

export const TRANSFORMATION_PROCESSING_STEPS = [
  "Scan",
  "Classify",
  "Protect",
  "Package",
] as const;

export const TRANSFORMATION_AFTER_ITEMS = [
  { label: "Safe cleanup candidates", value: `${DEMO_SCAN_STATS.safeCandidates} files`, level: "safe" as const },
  { label: "Review-required findings", value: `${DEMO_SCAN_STATS.reviewFirst} items`, level: "review" as const },
  { label: "Protected files", value: `${DEMO_SCAN_STATS.doNotTouch} locked`, level: "protected" as const },
  { label: "Patch artifacts", value: "7 files", level: "cyan" as const },
  { label: "Regression plan", value: "build · lint · routes", level: "cyan" as const },
  { label: "Estimated cleanup reduction", value: `${DEMO_SCAN_STATS.unusedFiles} files flagged`, level: "mint" as const },
] as const;

export const BEFORE_DIFF_ITEMS = [
  "ButtonFinal.tsx",
  "ButtonCopy.tsx",
  "OldDashboard.tsx",
  "unused package: lodash",
  "orphan route: app/api/old-execute",
];

export const AFTER_DIFF_ITEMS = [
  { label: "SAFE CANDIDATE", detail: `${DEMO_SCAN_STATS.safeCandidates} files` },
  { label: "REVIEW FIRST", detail: `${DEMO_SCAN_STATS.reviewFirst} items` },
  { label: "DO NOT TOUCH", detail: `${DEMO_SCAN_STATS.doNotTouch} protected` },
  { label: "PATCH BUNDLE", detail: "7 artifacts" },
  { label: "REGRESSION CHECK", detail: "build · lint · routes" },
];

export const BEFORE_ITEMS = [
  "Duplicate components with unclear ownership",
  "Unused packages from old AI suggestions",
  "Route experiments left behind",
  "TODO/FIXME placeholders hidden in source",
  "No safe order for cleanup",
];

export const AFTER_ITEMS = [
  "Findings grouped by risk",
  "Safe candidates separated from review items",
  "Protected files clearly marked",
  "Patch bundle generated",
  "Regression checklist ready before edits",
];

export const FLOW_METRICS = [
  "Raw repo",
  "Risk map",
  "Patch bundle",
  "Verification plan",
];

export const OUTPUTS_SECTION = {
  eyebrow: "Deliverables",
  title: "RepoDiet does not just report problems. It ships cleanup artifacts.",
  subtitle: "Sample bundle generated from the messy demo repo — real Patch Kit output.",
};

export const ARTIFACT_PREVIEWS = [
  {
    filename: "repodiet-report.md",
    purpose: "Executive summary of cleanup debt.",
    preview: `# RepoDiet Cleanup Report

## Summary
- Duplicate clusters: ${DEMO_SCAN_STATS.duplicateClusters}
- Unused files: ${DEMO_SCAN_STATS.unusedFiles}
- Safe candidates: ${DEMO_SCAN_STATS.safeCandidates}
- Review-first items: ${DEMO_SCAN_STATS.reviewFirst}`,
  },
  {
    filename: "repodiet-cleanup.patch",
    purpose: "Conservative patch plan using safe candidates only.",
    preview: `# RepoDiet cleanup patch
# Safe delete commands — review before applying.
# No automatic delete unless Safe Candidates exist.
git rm archive/OldDashboard.tsx
git rm backup/GeneratedCardCopy.tsx
git rm tmp/temp-widget.tsx
git rm old/UnusedLandingOld.tsx`,
  },
  {
    filename: "package-cleanup.md",
    purpose: "Dependency cleanup suggestions with fallback warnings.",
    preview: `# Package Cleanup Suggestions

## Review before removing
> Analyzer source marked — confirm usage before uninstalling.`,
  },
  {
    filename: "regression-checklist.md",
    purpose: "Build, lint, route, and API checks before merging.",
    preview: `# RepoDiet Regression Checklist

## Build checks
- [ ] Install dependencies
- [ ] Run lint
- [ ] Run production build`,
  },
  {
    filename: "cursor-prompt.md",
    purpose: "Ready-to-paste cleanup instructions for Cursor or Claude Code.",
    preview: `# Cursor Cleanup Prompt

Review safe candidates first. Do not delete protected routes or configs.
Group findings by safest-first cleanup order.`,
  },
  {
    filename: "findings.json",
    purpose: "Structured machine-readable output for agents and APIs.",
    preview: `{
  "scanId": "scan_...",
  "summary": { "duplicateClusters": ${DEMO_SCAN_STATS.duplicateClusters} },
  "riskBuckets": { "safeDelete": [...], "reviewFirst": [...] }
}`,
  },
  {
    filename: "patchkit-summary.json",
    purpose: "Bundle metadata for delivery and audit.",
    preview: `{
  "bundleFileCount": 7,
  "summary": {
    "safeCandidates": ${DEMO_SCAN_STATS.safeCandidates},
    "reviewFirstItems": ${DEMO_SCAN_STATS.reviewFirst}
  }
}`,
  },
] as const;

export const SAFETY_SECTION = {
  eyebrow: "Safety model",
  title: "Built to avoid reckless AI cleanup.",
};

export const SAFETY_PROTECTED_CATEGORIES = [
  { id: "routes", label: "Routes", angle: 0 },
  { id: "env", label: "Environment files", angle: 60 },
  { id: "config", label: "Configuration files", angle: 120 },
  { id: "lockfiles", label: "Lockfiles", angle: 180 },
  { id: "api", label: "API handlers", angle: 240 },
  { id: "assets", label: "Public assets", angle: 300 },
] as const;

export const SAFETY_PRINCIPLES = [
  { title: "No repository mutation", description: "RepoDiet never writes to your GitHub repo." },
  { title: "No automatic deletion", description: "Cleanup artifacts are review-first — you decide what merges." },
  { title: "Human-controlled merge", description: "Patches are generated for review, not applied silently." },
  { title: "Regression-first verification", description: "Every bundle includes build, lint, and route checks." },
  { title: "Fallback transparency", description: "Analyzer sources are marked: native or fallback." },
] as const;

/** @deprecated Use SAFETY_PRINCIPLES */
export const SAFETY_CARDS = SAFETY_PRINCIPLES.map((p) => ({
  title: p.title,
  description: p.description,
}));

export const DEMO_SECTION = {
  eyebrow: "Live demo",
  title: "See RepoDiet on a repo built to be messy.",
  description:
    "The demo repo contains intentional AI-code-bloat patterns — duplicate components, dead files, unused packages, and safe-delete candidates. Same engine as production scans. No fake findings.",
};

export const API_SECTION = {
  eyebrow: "Agent-ready",
  title: "JSON tools for CI, agents, and automation.",
  description:
    "Deterministic endpoints callable with a public repo URL. No browser session required — wire RepoDiet into your cleanup workflow.",
};

export const PRICING_SECTION = {
  eyebrow: "Plans",
  title: "Start free. Scale when you need full bundles.",
  description:
    "Scan and preview on the public demo. Full patch bundles when you need deliverable cleanup artifacts.",
  note:
    "Public demo endpoints are open for review. Paid gating can be added at the OKX listing layer.",
};

export const A2MCP_TOOLS = TOOL_MANIFEST_ENTRIES.map((t) => t.name);

export const A2MCP_TOOL_GROUPS = [
  {
    category: "Analysis",
    tools: ["detect_duplicate_code", "find_dead_files", "find_unused_dependencies"],
  },
  {
    category: "Classification",
    tools: ["scan_repo_bloat"],
  },
  {
    category: "Generation",
    tools: ["generate_cleanup_patch"],
  },
  {
    category: "Verification",
    tools: ["generate_regression_checklist"],
  },
] as const;

export const DEMO_PROGRESS_STEPS = [
  "Repository loaded",
  "Structure mapped",
  "Findings classified",
  "Bundle generated",
  "Verification prepared",
] as const;

export const PRICING_TIERS = [
  {
    name: "Demo",
    price: "Free",
    description: "Explore RepoDiet on the messy demo repo.",
    features: [
      "Demo repo scan",
      "Findings preview",
      "Patch bundle preview",
      "Sample ZIP download",
    ],
    cta: "Try Messy Demo",
    href: "/app?demo=true",
    highlighted: false,
  },
  {
    name: "Quick Scan",
    price: "0.05 USDT",
    description: "Structure scan and bloat summary for a public repository.",
    features: [
      "Repo structure",
      "Bloat summary",
      "Risk buckets",
      "findings.json",
    ],
    cta: "Scan a Repo",
    href: "/app",
    highlighted: false,
  },
  {
    name: "Patch Bundle",
    price: "0.25 USDT",
    description: "Full conservative cleanup bundle with seven artifacts.",
    features: [
      "Cleanup report",
      "Patch plan",
      "Package cleanup",
      "Regression checklist",
      "Cursor prompt",
      "ZIP bundle",
    ],
    cta: "Generate Bundle",
    href: "/app?tab=patch",
    highlighted: true,
  },
  {
    name: "A2A Cleanup",
    price: "Custom",
    description: "Guided cleanup delivery with human review gates.",
    features: [
      "Manual review",
      "Cleanup plan",
      "Patch delivery",
      "Verification checklist",
    ],
    cta: "Contact us",
    href: "/okx",
    highlighted: false,
  },
];

export const OKX_DEMO_FLOW = [
  "Open RepoDiet app and scan a public GitHub repository",
  "Run Findings Engine to map duplicates, unused code, and risk buckets",
  "Generate Patch Kit — conservative bundle with 7 artifacts",
  "Download ZIP and run regression checklist before any cleanup",
  "Call A2MCP JSON endpoints directly for agent integration",
];

export const SAFETY_POLICY_PUBLIC = [
  "RepoDiet never mutates repositories.",
  "RepoDiet never asks for private GitHub tokens.",
  "RepoDiet only scans public repos.",
  "RepoDiet never reads or displays .env values.",
  "RepoDiet never auto-deletes files.",
  "Patch bundles are review-first artifacts.",
];

export const RUNTIME_LIMITS = [
  "Public GitHub repos only",
  "Max ZIP size: 25MB",
  "Max files: 5000",
  "Max single file read: 500KB",
  "Timeout: 60 seconds",
  "JavaScript/TypeScript focus",
  "Fallback analyzers may be used on serverless runtimes",
];

export const BUNDLE_FILE_LIST = [...BUNDLE_ARTIFACT_FILES];
