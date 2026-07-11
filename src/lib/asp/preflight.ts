import { runBasicScan } from "@/lib/scanner/run-scan";
import { ASP_MAX_REPOSITORY_FILES } from "./types";
import type { AspJobRecord } from "./types";
import { captureBaseCommitSha, resolveAspGitHubToken } from "./github-access";

export interface AspPreflightResult {
  repositoryAccess: "confirmed" | "missing";
  baseCommit?: string;
  projectRoot?: string;
  framework?: string;
  requiredChecks: Record<string, "available" | "unavailable">;
  repositorySize: "supported" | "too_large";
  deliveryScope: "supported" | "unsupported";
  fileCount?: number;
  reason?: string;
}

export async function runAspPreflight(job: AspJobRecord): Promise<AspPreflightResult> {
  const requiredChecks: Record<string, "available" | "unavailable"> = {};
  for (const check of job.requiredChecks) {
    requiredChecks[check] = "available";
  }

  try {
    await resolveAspGitHubToken({
      owner: job.repositoryOwner,
      repo: job.repositoryName,
      installationId: job.githubInstallationId,
    });

    const baseCommit = await captureBaseCommitSha({
      owner: job.repositoryOwner,
      repo: job.repositoryName,
      branch: job.baseBranch,
      installationId: job.githubInstallationId,
    });

    let fileCount = 0;
    let projectRoot = ".";
    let framework = "unknown";
    let deliveryScope: "supported" | "unsupported" = "supported";
    let repositorySize: "supported" | "too_large" = "supported";

    try {
      const scan = await runBasicScan(job.repositoryUrl, job.baseBranch);
      fileCount = scan.summary.totalFiles;
      projectRoot = scan.repositoryModel?.primaryProjectRoot ?? ".";
      framework = scan.framework.name;
      if (scan.repositoryModel?.needsProjectRootSelection) {
        deliveryScope = "unsupported";
      }
      if (fileCount > ASP_MAX_REPOSITORY_FILES) {
        repositorySize = "too_large";
        deliveryScope = "unsupported";
      }
      const scripts = await readScriptsFromScan(scan);
      for (const check of job.requiredChecks) {
        if (check === "typecheck" && !scripts.typecheck) {
          requiredChecks[check] = "unavailable";
        }
        if (check === "lint" && !scripts.lint) {
          requiredChecks[check] = "unavailable";
        }
        if (check === "test" && !scripts.test) {
          requiredChecks[check] = "unavailable";
        }
        if (check === "build" && !scripts.build) {
          requiredChecks[check] = "unavailable";
        }
      }
    } catch {
      deliveryScope = "unsupported";
    }

    return {
      repositoryAccess: "confirmed",
      baseCommit,
      projectRoot,
      framework,
      requiredChecks,
      repositorySize,
      deliveryScope,
      fileCount,
    };
  } catch (err) {
    return {
      repositoryAccess: "missing",
      requiredChecks,
      repositorySize: "supported",
      deliveryScope: "unsupported",
      reason: err instanceof Error ? err.message : "Repository preflight failed.",
    };
  }
}

async function readScriptsFromScan(
  scan: Awaited<ReturnType<typeof runBasicScan>>
): Promise<Record<string, boolean>> {
  const hasConfig = (name: string) => scan.configFiles.some((c) => c.includes(name));
  return {
    typecheck: hasConfig("tsconfig"),
    lint: hasConfig("eslint") || hasConfig("biome"),
    test: hasConfig("vitest") || hasConfig("jest"),
    build: hasConfig("next.config") || hasConfig("vite.config") || hasConfig("tsconfig"),
  };
}
