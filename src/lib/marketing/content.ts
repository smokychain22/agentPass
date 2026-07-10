import { BUNDLE_ARTIFACT_FILES } from "@/lib/patch-kit/bundle-manifest";
import { TOOL_MANIFEST_ENTRIES } from "@/lib/a2mcp/tool-manifest";

export const TRUST_LINE =
  "Public GitHub repos only · No repo mutation · No auto-delete · Review-first patches";

export const A2MCP_READINESS_COPY =
  "RepoDiet endpoints are A2MCP-ready deterministic JSON tools. Payment/x402 enforcement can be added at the OKX listing or gateway layer. Public demo endpoints are open for hackathon review.";

export const DEMO_TERMINAL_LINES = [
  { text: "$ repodiet scan github.com/repodiet/demo-slop-app", className: "text-foreground" },
  { text: "", className: "" },
  { text: "Fetching repository...", className: "text-muted-foreground" },
  { text: "Framework: Next.js", className: "text-electric" },
  { text: "Package manager: npm", className: "text-electric" },
  { text: "Files indexed: 214", className: "text-electric" },
  { text: "Duplicate clusters: 18", className: "text-electric" },
  { text: "Unused files: 42", className: "text-electric" },
  { text: "AI-slop signals: 9", className: "text-electric" },
  { text: "Patch bundle: ready", className: "text-signal" },
];

export const PROBLEM_CARDS = [
  {
    title: "AI code bloat",
    description:
      "Vibe-coded repos accumulate generated scaffolding, experiments, and half-finished modules that nobody audits.",
  },
  {
    title: "Duplicate components",
    description:
      "AI agents often create Button2, ButtonFinal, NewCard, and unused UI variants instead of refactoring existing code.",
  },
  {
    title: "Dead files",
    description:
      "Backup folders, old routes, and orphaned utilities linger after rapid iteration cycles.",
  },
  {
    title: "Unused packages",
    description:
      "Dependencies get installed from AI suggestions and never removed from package.json.",
  },
  {
    title: "Orphan modules",
    description:
      "Disconnected files sit outside the import graph — hard to spot without dependency analysis.",
  },
  {
    title: "Fragile cleanup",
    description:
      "Deleting the wrong route, config, or API handler breaks production with no regression plan.",
  },
];

export const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Scan repo",
    description: "Ingest a public GitHub repository — framework, file tree, and structure metadata.",
  },
  {
    step: "2",
    title: "Map findings",
    description:
      "Detect duplicates, unused files, dependency drift, orphan patterns, and AI-slop signals.",
  },
  {
    step: "3",
    title: "Generate patch kit",
    description:
      "Produce a conservative cleanup bundle — not auto-clean, review-first artifacts only.",
  },
  {
    step: "4",
    title: "Verify safely",
    description: "Run the regression checklist before merging any cleanup changes.",
  },
];

export const BEFORE_ITEMS = [
  "Duplicate components scattered across folders",
  "Packages installed by AI but not used",
  "Old route experiments still present",
  "TODO/FIXME placeholders hidden in source",
  "No cleanup checklist",
];

export const AFTER_ITEMS = [
  "Findings grouped by risk",
  "Safe candidates separated from review items",
  "Do Not Touch files protected",
  "Patch bundle generated",
  "Regression checklist ready",
];

export const FLOW_METRICS = [
  "Raw findings",
  "Risk buckets",
  "Patch bundle",
  "Regression checklist",
];

export const ARTIFACT_PREVIEWS = [
  {
    filename: "repodiet-report.md",
    purpose: "Executive cleanup report for demo delivery and A2A handoff.",
    preview: `# RepoDiet Cleanup Report

## Summary
- Raw review findings: 288
- Unique review items: 170
- Safe candidates: 0
- Do not touch protected items: 6`,
  },
  {
    filename: "repodiet-cleanup.patch",
    purpose: "Conservative safe-delete patch plan — review before applying.",
    preview: `# RepoDiet cleanup patch
No automatic delete operations generated.
Current findings require review before patching.`,
  },
  {
    filename: "package-cleanup.md",
    purpose: "Dependency removal suggestions with fallback warnings.",
    preview: `# Package Cleanup Suggestions

## Review before removing
> Fallback detector used — confirm usage before uninstalling.`,
  },
  {
    filename: "regression-checklist.md",
    purpose: "Build, route, and API checks to run after cleanup.",
    preview: `# RepoDiet Regression Checklist

## Build checks
- [ ] Install dependencies
- [ ] Run lint
- [ ] Run production build`,
  },
  {
    filename: "cursor-prompt.md",
    purpose: "Ready-to-paste Cursor agent cleanup instructions.",
    preview: `# Cursor Cleanup Prompt

Safe candidates are 0, so do not generate delete operations yet.
Only propose a review plan and group findings by safest-first cleanup order.`,
  },
  {
    filename: "findings.json",
    purpose: "Full structured findings payload for agents and export.",
    preview: `{
  "scanId": "scan_...",
  "summary": { "duplicateClusters": 50, "reviewRequired": 288 },
  "riskBuckets": { "safeDelete": [], "reviewFirst": [...] }
}`,
  },
  {
    filename: "patchkit-summary.json",
    purpose: "Bundle metadata with artifact list and count semantics.",
    preview: `{
  "bundleFileCount": 7,
  "summary": {
    "rawReviewFindings": 288,
    "reviewFirstItems": 170
  }
}`,
  },
] as const;

export const A2MCP_TOOLS = TOOL_MANIFEST_ENTRIES.map((t) => t.name);

export const PRICING_TIERS = [
  {
    name: "Free Demo",
    price: "0 USDT",
    description: "Explore RepoDiet on the public demo deployment.",
    features: [
      "Public demo repo",
      "Scan preview",
      "Findings preview",
      "Patch bundle preview",
    ],
    cta: "Try Demo Repo",
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
    cta: "Run Scan",
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
    description: "Agent-to-agent cleanup delivery with human review gates.",
    features: [
      "Manual review",
      "Cleanup plan",
      "Patch delivery",
      "Verification checklist",
    ],
    cta: "Contact via OKX",
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
