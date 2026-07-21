import { Phase3InputSchemas } from "@/lib/a2mcp/phase3-schemas";
import {
  assertQuickTriageSummaryInvariants,
  buildQuickTriageResult,
} from "@/lib/a2mcp/quick-triage-response";
import { runBoundedQuickTriageScan } from "@/lib/a2mcp/quick-triage-bounded";
import { getAgentTask, type AgentTaskRecord } from "@/lib/a2mcp/task-store";
import type { FindingsPayload } from "@/lib/findings/types";

async function completeQuickTriageTask(
  taskId: string,
  analyzed: FindingsPayload,
  maximumFindings: number,
  meta?: {
    timings?: unknown;
    totalMs?: number;
    mode?: string;
    status?: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    coverage?: {
      mode: string;
      filesInspected: number;
      maximumFiles: number;
      limitations: string[];
    };
    recommendedNextAction?: string;
  }
): Promise<AgentTaskRecord> {
  const result = buildQuickTriageResult(analyzed, maximumFindings, {
    status: meta?.status,
    coverage: meta?.coverage,
    recommendedNextAction: meta?.recommendedNextAction,
  });
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
    result: {
      ...(result as unknown as Record<string, unknown>),
      ...(meta?.timings ? { timings: meta.timings } : {}),
      ...(meta?.totalMs != null ? { totalMs: meta.totalMs } : {}),
      ...(meta?.mode ? { triageMode: meta.mode } : {}),
    },
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
    limitations: [
      "Bounded Quick Triage path: ZIP archive fetch only, no dependency install, no build/tests, no native knip/jscpd/madge CLI.",
    ],
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

  // Prefer cached findings when scanId/taskId are provided.
  if (ref.scanId || ref.taskId) {
    const { resolveFindingsPayload } = await import("@/lib/a2mcp/phase3-schemas");
    const { analyzeRepository } = await import("@/lib/execution");
    const findings = await resolveFindingsPayload(ref, getAgentTask);
    const analyzed = await analyzeRepository(findings);
    return completeQuickTriageTask(taskId, analyzed, maximumFindings, {
      mode: "cached_findings",
    });
  }

  if (!ref.repoUrl) {
    throw new Error("repositoryUrl/repoUrl is required for Quick Triage.");
  }

  const bounded = await runBoundedQuickTriageScan(ref.repoUrl, ref.branch, ref.commitSha);
  return completeQuickTriageTask(taskId, bounded.findings, maximumFindings, {
    timings: bounded.timings,
    totalMs: bounded.totalMs,
    mode: bounded.coverage.mode,
    status: bounded.status,
    coverage: bounded.coverage,
    recommendedNextAction: bounded.recommendedNextAction,
  });
}
