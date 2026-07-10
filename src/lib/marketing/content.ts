import { BUNDLE_ARTIFACT_FILES } from "@/lib/patch-kit/bundle-manifest";
import { TOOL_MANIFEST_ENTRIES } from "@/lib/a2mcp/tool-manifest";
import { buildDemoTerminalLines, getDemoScanStats } from "@/lib/demo/terminal-lines";

export const TRUST_LINE =
  "Public GitHub repos only · No repo mutation · No auto-delete · Review-first patches";

export const FOOTER_OKX_COPY =
  "RepoDiet is also available as an A2MCP-ready Software Utility for agent workflows.";

export const A2MCP_READINESS_COPY =
  "RepoDiet endpoints are A2MCP-ready deterministic JSON tools. Payment/x402 enforcement can be added at the OKX listing or gateway layer. Public demo endpoints are open for hackathon review.";

export const DEMO_TERMINAL_LINES = buildDemoTerminalLines();
export const DEMO_SCAN_STATS = getDemoScanStats();

export const HERO = {
  badge: "AI CODEBASE CLEANUP",
  headline: "Your AI-built repo is getting heavier every commit.",
  subheadline:
    "RepoDiet scans JavaScript and TypeScript codebases for duplicate logic, unused files, dependency drift, orphan modules, and AI-slop patterns — then generates a conservative cleanup bundle your team can review safely.",
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
    title: "Duplicate logic",
    description: "AI creates new files instead of refactoring old ones.",
  },
  {
    category: "Debt",
    title: "Dead files",
    description: "Old screens, backup folders, and unused components stay behind.",
  },
  {
    category: "Debt",
    title: "Dependency drift",
    description: "Packages get installed for experiments and never removed.",
  },
  {
    category: "Debt",
    title: "Orphan modules",
    description: "Utilities and routes become disconnected from the real app flow.",
  },
  {
    category: "Risk",
    title: "Fragile cleanup",
    description: "Deleting the wrong file can break routes, APIs, or builds.",
  },
];

export const PIPELINE_STEPS = [
  {
    id: "messy",
    title: "Messy Repo",
    chips: ["Duplicates", "Dead files", "Drift"],
    accent: "muted" as const,
  },
  {
    id: "scan",
    title: "Scan",
    chips: ["Framework", "Package mgr", "File tree"],
    accent: "electric" as const,
  },
  {
    id: "findings",
    title: "Findings",
    chips: ["Duplicates", "Unused", "AI-slop"],
    accent: "electric" as const,
  },
  {
    id: "buckets",
    title: "Risk Buckets",
    chips: ["Safe", "Review", "Protected"],
    accent: "signal" as const,
  },
  {
    id: "bundle",
    title: "Patch Bundle",
    chips: ["Report", "Patch", "Cursor prompt"],
    accent: "signal" as const,
  },
  {
    id: "verify",
    title: "Verify",
    chips: ["Build", "Lint", "Routes"],
    accent: "electric" as const,
  },
];

export const TRANSFORMATION_SECTION = {
  eyebrow: "Transformation",
  title: "From scattered AI output to review-ready cleanup.",
};

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

export const SAFETY_CARDS = [
  {
    title: "No repo mutation",
    description: "RepoDiet never writes to your GitHub repo.",
  },
  {
    title: "No auto-delete",
    description: "Cleanup artifacts are review-first — you decide what merges.",
  },
  {
    title: "Protected files",
    description:
      "Routes, env files, configs, lockfiles, API handlers, and public assets are protected.",
  },
  {
    title: "Fallback transparency",
    description: "Analyzer sources are marked: native or fallback.",
  },
  {
    title: "Regression-first",
    description: "Every bundle includes checks before merging.",
  },
];

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
