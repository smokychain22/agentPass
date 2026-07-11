import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitRepoContext } from "./types";

const DEFAULT_ROUTES = ["/", "/app", "/docs", "/okx"];
const DEFAULT_API_ROUTES = [
  "/api/scans/run",
  "/api/findings/run",
  "/api/patch-kit/generate",
];

function pagePathToRoute(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const pageMatch = normalized.match(/(^|\/)app\/(.+)\/page\.(tsx?|jsx?)$/);
  if (pageMatch) {
    const segments = pageMatch[2].replace(/\/page$/, "");
    return segments ? `/${segments}` : "/";
  }
  if (/(^|\/)app\/page\.(tsx?|jsx?)$/.test(normalized)) return "/";
  const pagesMatch = normalized.match(/(^|\/)pages\/(.+)\.(tsx?|jsx?)$/);
  if (pagesMatch && !pagesMatch[2].startsWith("api/")) {
    const route = pagesMatch[2].replace(/\/index$/, "").replace(/index$/, "");
    return route ? `/${route}` : "/";
  }
  return null;
}

function apiPathToRoute(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const appApi = normalized.match(/(^|\/)app\/api\/(.+)\/route\.(tsx?|jsx?)$/);
  if (appApi) return `/api/${appApi[2]}`;
  const pagesApi = normalized.match(/(^|\/)pages\/api\/(.+)\.(tsx?|jsx?)$/);
  if (pagesApi) return `/api/${pagesApi[2]}`;
  return null;
}

export function detectRepoContextFromFindings(findings: FindingsPayload): PatchKitRepoContext {
  const allPaths = new Set<string>();
  const addPaths = (paths: string[]) => paths.forEach((p) => allPaths.add(p.replace(/\\/g, "/")));

  for (const f of findings.duplicates) addPaths(f.files);
  for (const f of findings.unused.files) addPaths(f.files);
  for (const f of findings.unused.exports) addPaths(f.files);
  for (const f of findings.orphans) addPaths(f.files);
  for (const f of findings.slopSignals) addPaths(f.files);

  const routes = new Set<string>(DEFAULT_ROUTES);
  const apiRoutes = new Set<string>(DEFAULT_API_ROUTES);

  for (const p of allPaths) {
    const route = pagePathToRoute(p);
    if (route) routes.add(route);
    const api = apiPathToRoute(p);
    if (api) apiRoutes.add(api);
  }

  const hasAppDir = [...allPaths].some((p) => p.startsWith("app/"));
  const hasNextSignals = hasAppDir || [...allPaths].some((p) => /next\.config/.test(p));

  return {
    framework: hasNextSignals ? "Next.js" : "Unknown JS/TS",
    packageManager: "npm",
    routes: [...routes].sort(),
    apiRoutes: [...apiRoutes].sort(),
    hasTypecheck: true,
    hasLint: true,
    hasBuild: true,
  };
}

export function generateRegressionChecklist(
  context: PatchKitRepoContext,
  packageManager: string = context.packageManager
): { markdown: string; checkCount: number } {
  const installCmd =
    packageManager === "pnpm"
      ? "pnpm install"
      : packageManager === "yarn"
        ? "yarn install"
        : packageManager === "bun"
          ? "bun install"
          : "npm install";

  const lintCmd =
    packageManager === "pnpm"
      ? "pnpm run lint"
      : packageManager === "yarn"
        ? "yarn lint"
        : packageManager === "bun"
          ? "bun run lint"
          : "npm run lint";

  const buildCmd =
    packageManager === "pnpm"
      ? "pnpm run build"
      : packageManager === "yarn"
        ? "yarn build"
        : packageManager === "bun"
          ? "bun run build"
          : "npm run build";

  const typecheckCmd =
    packageManager === "pnpm"
      ? "pnpm exec tsc --noEmit"
      : packageManager === "yarn"
        ? "yarn tsc --noEmit"
        : packageManager === "bun"
          ? "bunx tsc --noEmit"
          : "npx tsc --noEmit";

  const lines: string[] = [
    "# RepoDiet Regression Checklist",
    "",
    "## Build checks",
    "",
    "- [ ] Install dependencies",
  ];

  if (context.hasTypecheck) lines.push("- [ ] Run typecheck");
  if (context.hasLint) lines.push("- [ ] Run lint");
  if (context.hasBuild) lines.push("- [ ] Run production build");

  lines.push("", "## Suggested commands", "", "```bash", installCmd);
  if (context.hasLint) lines.push(lintCmd);
  if (context.hasTypecheck) lines.push(typecheckCmd);
  if (context.hasBuild) lines.push(buildCmd);
  lines.push("```", "", "## Route checks", "");

  for (const route of context.routes) {
    lines.push(`- [ ] ${route}`);
  }

  lines.push("", "## API checks", "");
  for (const api of context.apiRoutes) {
    lines.push(`- [ ] ${api}`);
  }

  lines.push(
    "",
    "## Protected files",
    "",
    "RepoDiet did not generate delete operations for:",
    "",
    "- env files",
    "- config files",
    "- lockfiles",
    "- app routes",
    "- API routes",
    "- public assets",
    ""
  );

  const checkCount =
    1 +
    (context.hasTypecheck ? 1 : 0) +
    (context.hasLint ? 1 : 0) +
    (context.hasBuild ? 1 : 0) +
    context.routes.length +
    context.apiRoutes.length;

  return { markdown: lines.join("\n"), checkCount };
}
