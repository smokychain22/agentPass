import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { runBasicScan } from "@/lib/scanner/run-scan";
import {
  detectRepoContextFromFindings,
  generateRegressionChecklist,
} from "@/lib/patch-kit/generate-regression-checklist";
import {
  REGRESSION_PROTECTED_FILES,
} from "@/lib/a2mcp/constants";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import type { PatchKitRepoContext } from "@/lib/patch-kit/types";

function buildChecks(context: PatchKitRepoContext) {
  const pm = context.packageManager;
  const install =
    pm === "pnpm" ? "pnpm install" : pm === "yarn" ? "yarn install" : pm === "bun" ? "bun install" : "npm install";
  const lint =
    pm === "pnpm" ? "pnpm run lint" : pm === "yarn" ? "yarn lint" : pm === "bun" ? "bun run lint" : "npm run lint";
  const build =
    pm === "pnpm" ? "pnpm run build" : pm === "yarn" ? "yarn build" : pm === "bun" ? "bun run build" : "npm run build";

  const buildChecks = [install];
  if (context.hasLint) buildChecks.push(lint);
  if (context.hasBuild) buildChecks.push(build);

  return {
    build: buildChecks,
    routes: context.routes,
    apiRoutes: context.apiRoutes,
    protectedFiles: [...REGRESSION_PROTECTED_FILES],
  };
}

async function resolveContext(repoUrl: string, branch?: string) {
  const findings = await runFindingsEngine(repoUrl, branch);
  const fromFindings = detectRepoContextFromFindings(findings);

  try {
    const scan = await runBasicScan(repoUrl, branch ?? findings.repo.branch);
    return {
      findings,
      context: {
        ...fromFindings,
        framework: scan.framework.name,
        packageManager: scan.packageManager,
      } satisfies PatchKitRepoContext,
    };
  } catch {
    return { findings, context: fromFindings };
  }
}

export async function executeGenerateRegressionChecklist(body: unknown) {
  const input = ToolInputSchemas.repoOnly(body);
  const { findings, context } = await resolveContext(input.repoUrl, input.branch);
  const { markdown } = generateRegressionChecklist(context, context.packageManager);
  const checks = buildChecks(context);

  return {
    data: {
      repo: {
        owner: findings.repo.owner,
        name: findings.repo.name,
        branch: findings.repo.branch,
      },
      checklistMd: markdown,
      checks,
    },
    warnings: [] as string[],
  };
}
