import { BUNDLE_ARTIFACT_FILES } from "@/lib/patch-kit/bundle-manifest";
import { TOOL_MANIFEST_ENTRIES } from "@/lib/a2mcp/tool-manifest";
import { buildDemoTerminalLines, getDemoScanStats } from "@/lib/demo/terminal-lines";

export const TRUST_POINTS = [
  "Public repositories only",
  "No main-branch pushes",
  "Review-first cleanup PRs",
] as const;

export const TRUST_LINE = TRUST_POINTS.join(" · ");

export const FOOTER_OKX_COPY =
  "RepoDiet on OKX.AI: A2MCP Quick Triage (x402) and A2A Verified Cleanup PR (escrow). ASP 5283 · production https://skillswap-virid-kappa.vercel.app";

export const A2MCP_READINESS_COPY =
  "A2MCP Quick Triage (service 32948, analyze_repository) is live at 0.03 USD₮0 via x402 on X Layer. A2A Verified Cleanup PR (service 32947, create_cleanup_pr) uses negotiated task terms, escrow, and buyer acceptance — not x402 for every paid task.";

export const DEMO_TERMINAL_LINES = buildDemoTerminalLines();
export const DEMO_SCAN_STATS = getDemoScanStats();

export const HERO = {
  badge: "REPOSITORY INTELLIGENCE",
  headline: "Your AI-built repo is getting heavier every commit.",
  subheadline:
    "RepoDiet finds duplicate logic, dead files, dependency drift, and orphan modules—then applies verified fixes (remove imports, delete temp files, uninstall packages) and opens a review-ready cleanup PR. You merge when ready.",
};

export const SITE_TAGLINES = {
  debt: "AI code creates cleanup debt. RepoDiet Operator turns it into a review-ready cleanup PR.",
  positioning:
    "Not a linter. Not scan-only. A cleanup operator that edits files, deletes safe dead code, and opens PRs.",
  workflow: "Scan → Find problems → Apply fixes → Open cleanup PR → Verify → You merge.",
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
    title: "FIX",
    subtitle: "Apply verified changes",
    meta: "Unused imports · temp files · packages",
    accent: "electric" as const,
  },
  {
    id: "deliver",
    step: "05",
    title: "DELIVER",
    subtitle: "Cleanup PR + artifacts",
    meta: "7 artifacts · git-validated patch",
    accent: "electric" as const,
  },
  {
    id: "verify",
    step: "06",
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

export const SCAN_TO_PR_SECTION = {
  eyebrow: "From scan to pull request",
  title: "From scan to pull request",
  description:
    "AI agents should not only diagnose code debt. They should create review-safe changes. RepoDiet Operator opens cleanup PRs for safe candidates.",
};

export const SCAN_TO_PR_STEPS = [
  "Messy AI Repo",
  "Findings",
  "Risk Buckets",
  "Patch Kit",
  "Cleanup PR",
  "Human Merge",
] as const;

export const TOP3_STORY = {
  before: "Scanner + report bundle",
  after: "Safe cleanup operator + GitHub PR action",
  asp:
    "A2MCP: agents call analyze_repository for fast repository triage. A2A: users hire RepoDiet Operator to negotiate and deliver a review-ready cleanup PR.",
};

export const USE_CASES = [
  {
    title: "Before hackathon submission",
    description:
      "Create a cleanup PR that removes obvious archive/tmp/backup files and adds a regression checklist.",
  },
  {
    title: "Before client handoff",
    description:
      "Show a professional cleanup report and PR instead of handing over messy AI-generated code.",
  },
  {
    title: "After heavy Cursor/Claude sessions",
    description:
      "Find AI-created leftovers and open a review-safe cleanup branch.",
  },
  {
    title: "Before production deploy",
    description:
      "Separate safe cleanup from risky files so the team does not guess what to delete.",
  },
] as const;

export const TRANSFORMATION_SECTION = {
  eyebrow: "Transformation",
  title: "Watch repository debt become real fixes in a cleanup PR.",
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
  "Fix",
  "PR",
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
  "Unused imports removed from source files",
  "Temp and backup files deleted when safe",
  "Unused packages removed from package.json",
  "Findings grouped by risk with protected paths locked",
  "Cleanup PR opened on a branch — never pushed to main",
  "Regression checklist ready before you merge",
];

export const FLOW_METRICS = [
  "Raw repo",
  "Risk map",
  "Patch bundle",
  "Cleanup PR",
  "Human merge",
];

export const OUTPUTS_SECTION = {
  eyebrow: "Deliverables",
  title: "RepoDiet Operator does not just report problems. It opens review-ready cleanup PRs.",
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
git rm archive/OldScreen.tsx
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
  {
    title: "No main-branch pushes",
    description: "RepoDiet Operator opens a cleanup branch and PR — it never commits directly to main.",
  },
  {
    title: "Safe candidates only",
    description: "Only conservative safe-delete files are removed. Review-first items stay untouched.",
  },
  {
    title: "Protected files",
    description:
      "Routes, env files, configs, lockfiles, API handlers, and public assets are protected.",
  },
  {
    title: "Token hygiene",
    description: "Installation tokens are short-lived and generated server-side — never stored or logged.",
  },
  {
    title: "Regression-first",
    description: "Every cleanup PR includes checklist artifacts before merging.",
  },
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
  eyebrow: "OKX services",
  title: "Two live services. Clear protocol split.",
  description:
    "A2MCP Quick Triage is standardized pay-per-call via x402. A2A Verified Cleanup PR is customized delivery via negotiated task terms, escrow, and buyer acceptance.",
  note:
    "Canonical production origin: https://skillswap-virid-kappa.vercel.app · ASP 5283 · A2MCP 32948 · A2A 32947. Settlement is live on X Layer for A2MCP; A2A uses escrow and buyer release — not a flat x402 rail for every task.",
};

export const CLEANUP_PR_PRICING_NOTE =
  "A2A Verified Cleanup PR (create_cleanup_pr): negotiated price with default reference 1 USD₮0. Settlement uses A2A task agreement, escrow, delivery, buyer acceptance, and release.";

export const AGENT_API_PRICING = [
  {
    operation: "A2MCP Quick Triage",
    tool: "analyze_repository",
    price: "0.03 USD₮0",
    protocol: "A2MCP",
    settlement: "live x402 on X Layer",
  },
  {
    operation: "A2A Verified Cleanup PR",
    tool: "create_cleanup_pr",
    price: "negotiated (default 1 USD₮0)",
    protocol: "A2A",
    settlement: "escrow + buyer acceptance",
  },
] as const;

export const A2MCP_TOOLS_HIGHLIGHT = [
  "analyze_repository",
  "quick_triage",
] as const;

export const A2MCP_TOOLS = TOOL_MANIFEST_ENTRIES.map((t) => t.name);

export const A2MCP_TOOL_GROUPS = [
  {
    category: "A2MCP Quick Triage",
    tools: ["analyze_repository"],
  },
  {
    category: "A2A delivery (not A2MCP pay-per-call)",
    tools: ["create_cleanup_pr"],
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
    name: "A2MCP Quick Triage",
    price: "0.03 USD₮0",
    description:
      "Bounded repository triage returning up to five prioritized findings. Standardized pay-per-call through live x402 on X Layer.",
    features: [
      "Protocol: A2MCP",
      "Operation: analyze_repository",
      "Service ID: 32948",
      "Settlement: live x402 on X Layer",
      "Up to five prioritized findings",
      "Signed operator receipt after successful delivery",
    ],
    cta: "View A2MCP Quick Triage",
    href: "/okx#a2mcp-quick-triage",
    highlighted: false,
  },
  {
    name: "A2A Verified Cleanup PR",
    price: "negotiated",
    description:
      "Customized repository cleanup delivered as a review-ready GitHub pull request. Default reference price 1 USD₮0.",
    features: [
      "Protocol: A2A",
      "Operation: create_cleanup_pr",
      "Service ID: 32947",
      "Settlement: task agreement → escrow → delivery → buyer acceptance → release",
      "Isolated cleanup branch (never pushes to main)",
      "Default reference: 1 USD₮0",
    ],
    cta: "View A2A Cleanup PR",
    href: "/okx#a2a-cleanup-pr",
    highlighted: true,
  },
];

export const OKX_DEMO_FLOW = [
  "Hire ASP 5283 on OKX.AI once the public listing is live",
  "A2MCP Quick Triage (32948): pay 0.03 USD₮0 via x402 for bounded analyze_repository",
  "Inspect prioritized findings and signed receipt",
  "A2A Verified Cleanup PR (32947): negotiate scope, fund escrow, accept delivery",
  "Receive a review-ready GitHub cleanup PR — never an auto-merge to main",
];

export const OKX_A2MCP_SERVICE = {
  name: "RepoDiet Quick Triage",
  protocol: "A2MCP",
  operation: "analyze_repository",
  serviceId: "32948",
  price: "0.03 USD₮0 per call",
  settlement: "live x402 on X Layer",
  description:
    "Bounded repository triage returning up to five prioritized findings. Standardized A2MCP pay-per-call — not negotiated cleanup delivery.",
};

export const OKX_A2A_SERVICE = {
  name: "RepoDiet Verified Cleanup PR",
  protocol: "A2A",
  operation: "create_cleanup_pr",
  serviceId: "32947",
  price: "negotiated",
  defaultReferencePrice: "1 USD₮0",
  settlement: "A2A task agreement, escrow, delivery, buyer acceptance and release",
  description:
    "Customized repository cleanup delivered as a review-ready GitHub pull request. Negotiated A2A delivery with escrow and buyer acceptance — not an A2MCP x402 pay-per-call.",
};

export const OKX_JUDGE_PITCH = {
  headline: "Autonomous repository repair for AI-built codebases",
  problem:
    "AI coding tools help teams ship faster but leave duplicate logic, dead files, unused dependencies, and abandoned modules behind. General coding agents can fix these issues when explicitly prompted — but they require judgment, prompt engineering, and manual Git workflow.",
  differentiation:
    "RepoDiet is a vertical cleanup operator — not a horizontal coding agent. Connect a repository and RepoDiet automatically detects evidence-backed debt, applies deterministic transformations, verifies the repository, and delivers a review-ready pull request without cleanup prompts.",
  proofContract:
    "Every action moves through an auditable proof ladder: Detected → Eligible → Attempted → Generated → Validated → Verified → Delivered. Numbers come from backend execution, not scan-time estimates.",
  vsAgents: [
    "Cursor, Claude Code, and Codex can edit repositories — but users must instruct each cleanup step and manage safety.",
    "Sonar, Knip, and jscpd mostly detect — RepoDiet removes imports, deletes confirmed dead files, uninstalls packages, and opens PRs.",
    "Code-review bots inspect new changes — RepoDiet cleans accumulated repository debt and can prevent it from returning.",
  ],
  agentUtility:
    "A2MCP Quick Triage (analyze_repository, service 32948) is standardized pay-per-call through x402 at 0.03 USD₮0. A2A Verified Cleanup PR (create_cleanup_pr, service 32947) is negotiated delivery with escrow and buyer acceptance (default reference 1 USD₮0). Agents pay for verified outcomes — findings, diffs, verification logs, and PR URLs — not reports alone.",
  demoProof: [
    "A2MCP Quick Triage returns up to five prioritized findings with a signed receipt",
    "A2A Cleanup PR opens on an isolated cleanup branch — main untouched",
    "Protected Next.js routes, configs, env files, and lockfiles left untouched",
    "Buyer acceptance gates escrow release",
  ],
};

export const OKX_COMPETITIVE_POSITION = {
  nearDirect: "5–10 products (e.g. Slopfix, Moderne) overlap with repository cleanup and modernization.",
  adjacent: "40–70 tools cover parts of the workflow — static analyzers, review bots, and general coding agents.",
  repodietCategory:
    "Dependabot for repository bloat + Sonar for AI-generated debt + a deterministic cleanup agent — continuous hygiene, not one-off scans.",
};

export const SAFETY_POLICY_PUBLIC = [
  "Public scan mode needs no GitHub auth — scan, findings, and ZIP download only.",
  "Cleanup PR mode uses the RepoDiet GitHub App with minimum Contents + Pull Requests permissions.",
  "RepoDiet Operator never pushes directly to main.",
  "RepoDiet Operator never merges pull requests automatically.",
  "Installation tokens are short-lived and generated server-side — never exposed to the browser.",
  "Only safe-candidate files are deleted on cleanup branches.",
  "Every cleanup PR includes regression checklist artifacts.",
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
