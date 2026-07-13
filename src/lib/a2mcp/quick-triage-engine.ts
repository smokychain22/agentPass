import { analyzeRepository } from "@/lib/execution";
import { Phase3InputSchemas, resolveFindingsPayload } from "@/lib/a2mcp/phase3-schemas";
import {
  assertQuickTriageSummaryInvariants,
  buildQuickTriageResult,
} from "@/lib/a2mcp/quick-triage-response";
import { getAgentTask, type AgentTaskRecord } from "@/lib/a2mcp/task-store";

async function completeQuickTriageTask(
  taskId: string,
  analyzed: Awaited<ReturnType<typeof analyzeRepository>>,
  maximumFindings: number
): Promise<AgentTaskRecord> {
  const result = buildQuickTriageResult(analyzed, maximumFindings);
  assertQuickTriageSummaryInvariants(result);

  const task: AgentTaskRecord = {
    id: taskId,
    type: "analyze_repository",
    status: "completed",
    repository: {
      owner: analyzed.repo.owner,
      name: analyzed.repo.name,
      branch: analyzed.repo.branch,
      commitSha: analyzed.repo.commitSha,
    },
    scanId: analyzed.scanId,
    result: result as unknown as Record<string, unknown>,
    analyzers: {
      knip: {
        status: analyzed.rawToolReports.knip.status === "failed" ? "failed" : "ok",
        sourceMode: analyzed.rawToolReports.knip.sourceMode,
      },
      jscpd: {
        status: analyzed.rawToolReports.jscpd.status === "failed" ? "failed" : "ok",
        sourceMode: analyzed.rawToolReports.jscpd.sourceMode,
      },
      madge: {
        status: analyzed.rawToolReports.madge.status === "failed" ? "failed" : "ok",
        sourceMode: analyzed.rawToolReports.madge.sourceMode,
      },
    },
    limitations: [],
    receipt: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const { saveAgentTask } = await import("@/lib/a2mcp/task-store");
  return saveAgentTask(task);
}

export async function executeQuickTriage(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const record = body as Record<string, unknown>;
  const maximumFindingsRaw = record.maximumFindings;
  const maximumFindings =
    maximumFindingsRaw === undefined ? 10 : Number(maximumFindingsRaw);

  const ref = Phase3InputSchemas.repoRef(body);
  const findings = await resolveFindingsPayload(ref, getAgentTask);
  const analyzed = await analyzeRepository(findings);

  return completeQuickTriageTask(taskId, analyzed, maximumFindings);
}
