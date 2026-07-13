import { NextResponse } from "next/server";
import { submitA2ATask, approveA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { flattenFindings } from "@/lib/findings/client";
import { resolveRepositoryConnectionStatus } from "@/lib/workflow/github-repository-status";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { getBoundQuote } from "@/lib/payment";
import { formatWorkflowQuote } from "@/lib/workflow/format-workflow-quote";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Create scoped A2A cleanup task and return quote for browser payment flow. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      repoUrl: string;
      branch?: string;
      scanId: string;
      commitSha: string;
      findingIds: string[];
      autoApprove?: boolean;
    };

    if (!body.repoUrl || !body.scanId || !body.commitSha || !body.findingIds?.length) {
      return NextResponse.json(
        { ok: false, error: "repoUrl, scanId, commitSha, and findingIds are required." },
        { status: 400 }
      );
    }

    const findings = await getStoredFindings(body.scanId);
    if (!findings) {
      return NextResponse.json({ ok: false, error: "Stored findings not found." }, { status: 404 });
    }

    if (findings.repo.commitSha && findings.repo.commitSha !== body.commitSha) {
      return NextResponse.json(
        { ok: false, error: "repository_changed", message: "Scan commit no longer matches repository HEAD." },
        { status: 409 }
      );
    }

    const flat = flattenFindings(findings);
    const selected = flat.filter((f) => body.findingIds.includes(f.id));
    if (selected.length !== body.findingIds.length) {
      return NextResponse.json({ ok: false, error: "Invalid finding IDs in scope." }, { status: 400 });
    }
    if (!selected.every(isActionableFinding)) {
      return NextResponse.json(
        { ok: false, error: "Scope includes findings that are not safe for automatic cleanup." },
        { status: 422 }
      );
    }

    const repository = `${findings.repo.owner}/${findings.repo.name}`;
    const sessionKey = await buildSessionKey(request);
    const github = await resolveRepositoryConnectionStatus({
      repository,
      branch: body.branch ?? findings.repo.branch,
      commitSha: body.commitSha,
      sessionKey: sessionKey ?? undefined,
    });
    if (!github.connected) {
      return NextResponse.json(
        { ok: false, error: "github_authorization_required", github },
        { status: 403 }
      );
    }

    const task = await submitA2ATask("repository.cleanup_pr", {
      repoUrl: body.repoUrl,
      branch: body.branch ?? findings.repo.branch,
      scanId: body.scanId,
      commitSha: body.commitSha,
      findingIds: body.findingIds,
    });

    const quoteId =
      task.input.quoteId ??
      (typeof task.result?.receipt === "object" &&
      task.result?.receipt &&
      "quote" in (task.result.receipt as object)
        ? ((task.result.receipt as { quote?: { quoteId?: string } }).quote?.quoteId ?? undefined)
        : undefined);

    let quote = quoteId ? await getBoundQuote(quoteId) : null;
    if (!quote && task.limitations.length > 0) {
      const match = task.limitations.find((l) => l.startsWith("Quote "));
      if (match) {
        const id = match.split(" ")[1]?.replace(":", "");
        if (id) quote = await getBoundQuote(id);
      }
    }

    return NextResponse.json({
      ok: true,
      task: formatA2ATaskResponse(task),
      quote: quote ? formatWorkflowQuote(quote) : null,
      github,
      serviceId: "32947",
      operation: "verified_cleanup_pr",
      aspAgentId: "5283",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workflow task creation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ ok: false, error: "taskId is required." }, { status: 400 });
  }

  const task = await getA2ATask(taskId);
  if (!task) {
    return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
  }

  const quoteId = task.input.quoteId;
  const quote = quoteId ? await getBoundQuote(quoteId) : null;

  return NextResponse.json({
    ok: true,
    task: formatA2ATaskResponse(task),
    quote: quote ? formatWorkflowQuote(quote) : null,
    aspAgentId: "5283",
    serviceId: "32947",
  });
}

/** Auto-approve PR delivery after successful cleanup (browser flow). */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { taskId: string; action?: "approve" };
    if (!body.taskId) {
      return NextResponse.json({ ok: false, error: "taskId is required." }, { status: 400 });
    }
    if (body.action !== "approve") {
      return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
    }

    const task = await approveA2ATask(body.taskId, true);
    return NextResponse.json({ ok: true, task: formatA2ATaskResponse(task) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
