import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { getAgentTask } from "@/lib/a2mcp/task-store";
import type { CommerceBinding } from "./types";
import { buildCommerceBinding } from "./commerce-gateway";
import type { CommerceOperation } from "@/lib/payment/types";

export async function resolveBindingFromBody(
  body: Record<string, unknown>,
  operation: CommerceOperation
): Promise<CommerceBinding> {
  const commitSha =
    typeof body.commitSha === "string" && body.commitSha.trim()
      ? body.commitSha.trim()
      : undefined;
  const scanId = typeof body.scanId === "string" ? body.scanId.trim() : undefined;
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : undefined;
  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : undefined;
  const branch = typeof body.branch === "string" ? body.branch.trim() : "main";

  if (scanId) {
    const findings = await getStoredFindings(scanId);
    if (!findings) throw new Error(`Findings not found for scanId ${scanId}.`);
    return buildCommerceBinding({
      operation,
      repository: `${findings.repo.owner}/${findings.repo.name}`,
      branch: findings.repo.branch,
      commitSha: commitSha ?? findings.repo.commitSha ?? "unknown",
      findingIds: [],
    });
  }

  if (taskId) {
    const task = await getAgentTask(taskId);
    if (task?.scanId) {
      const findings = await getStoredFindings(task.scanId);
      if (findings) {
        return buildCommerceBinding({
          operation,
          repository: `${findings.repo.owner}/${findings.repo.name}`,
          branch: findings.repo.branch,
          commitSha: commitSha ?? findings.repo.commitSha ?? "unknown",
          findingIds: [],
        });
      }
    }
  }

  if (repoUrl) {
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) throw new Error("Invalid repository URL.");
    return buildCommerceBinding({
      operation,
      repository: `${parsed.owner}/${parsed.repo}`,
      branch,
      commitSha: commitSha ?? "pending_scan",
      findingIds: [],
    });
  }

  if (operation === "repository_health_delta") {
    const baseSha = typeof body.baseCommitSha === "string" ? body.baseCommitSha : "";
    const headSha = typeof body.headCommitSha === "string" ? body.headCommitSha : "";
    const repository =
      typeof body.repository === "string"
        ? body.repository
        : repoUrl
          ? (() => {
              const p = parseGitHubUrl(repoUrl);
              return p ? `${p.owner}/${p.repo}` : "unknown/unknown";
            })()
          : "unknown/unknown";
    return buildCommerceBinding({
      operation,
      repository,
      branch,
      commitSha: headSha || baseSha || "unknown",
      findingIds: [],
    });
  }

  throw new Error("Unable to resolve commerce binding — provide scanId, taskId, or repoUrl.");
}
