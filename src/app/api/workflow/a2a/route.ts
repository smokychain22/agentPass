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
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";
import { runEligibilityPreflight } from "@/lib/workflow/eligibility-preflight";
import {
  assertPreQuoteGate,
  PreQuoteGateError,
  preQuoteGateErrorResponse,
} from "@/lib/workflow/pre-quote-gate";
import { OKX_A2A_PUBLIC_OPERATION } from "@/lib/okx/services";
import { hashTaskOwnerSession, assertDirectTaskOwner } from "@/lib/workflow/task-access";
import {
  reviewDirectSiteDelivery,
} from "@/lib/a2a/direct-site-lifecycle";
import { newOkxOrderId, saveOkxOrder } from "@/lib/okx/store";
import { durableNow } from "@/lib/store/durable-store";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Create scoped OKX A2A cleanup task (service 32947) with escrow quote. */
export async function POST(request: Request) {
  try {
    const okxIdentity = getCanonicalOkxIdentity();
    const body = (await request.json()) as {
      repoUrl: string;
      branch?: string;
      scanId: string;
      commitSha: string;
      findingIds: string[];
      autoApprove?: boolean;
      /** Direct website vs OKX A2A marketplace — defaults to okx_marketplace for Fix & PR. */
      purchaseChannel?: "okx_marketplace" | "direct_site";
      /** Optional dynamic quote binding from user-directed plan preview. */
      dynamicQuoteId?: string;
      planHash?: string;
      amountMicro?: string;
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

    const eligibility = await runEligibilityPreflight({
      repoUrl: body.repoUrl,
      branch: body.branch ?? findings.repo.branch,
      findings: flat,
      findingIds: body.findingIds,
    });
    const executable = eligibility.filter(
      (r) => r.classification === "safe_candidate" && r.autoFixAllowed
    );
    if (executable.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "scope_not_executable",
          message:
            "None of the selected findings passed executable preflight. Re-run eligibility and select findings with confirmed dry-run before requesting a quote.",
          eligibility,
        },
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
    if (!github.connected || github.authoritativeState !== "repository_verified") {
      return NextResponse.json(
        { ok: false, error: "github_authorization_required", github },
        { status: 403 }
      );
    }

    let gateResult;
    try {
      gateResult = await assertPreQuoteGate({
        repoUrl: body.repoUrl,
        branch: body.branch ?? findings.repo.branch,
        scanId: body.scanId,
        commitSha: body.commitSha,
        findingIds: body.findingIds,
        findings: flat,
        repository,
        github,
      });
    } catch (err) {
      if (err instanceof PreQuoteGateError) {
        return NextResponse.json(preQuoteGateErrorResponse(err), { status: err.httpStatus });
      }
      throw err;
    }

    const purchaseChannel =
      body.purchaseChannel === "direct_site" ? "direct_site" : "okx_marketplace";

    const task = await submitA2ATask("repository.cleanup_pr", {
      repoUrl: body.repoUrl,
      branch: body.branch ?? findings.repo.branch,
      scanId: body.scanId,
      commitSha: body.commitSha,
      findingIds: gateResult.eligibleFindingIds,
      transformedSourceHashes: gateResult.transformedSourceHashes,
      purchaseChannel,
      ownerSessionKeyHash: hashTaskOwnerSession(sessionKey),
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

    const orderId = newOkxOrderId();
    await saveOkxOrder({
      orderId,
      serviceId: "verified_cleanup_pr",
      serviceType: "A2A",
      repository,
      branch: body.branch ?? findings.repo.branch,
      commitSha: body.commitSha,
      status: task.status,
      taskId: task.id,
      a2aTaskId: task.id,
      quoteId: quote?.quoteId,
      amountMicro: quote?.amountMicro,
      createdAt: durableNow(),
      updatedAt: durableNow(),
    });

    return NextResponse.json({
      ok: true,
      task: formatA2ATaskResponse(task),
      quote: quote ? formatWorkflowQuote(quote, { paymentModel: "escrow" }) : null,
      github,
      orderId,
      serviceId: String(okxIdentity.a2aServiceId),
      operation: OKX_A2A_PUBLIC_OPERATION,
      aspAgentId: String(okxIdentity.aspAgentId),
      paymentModel: "escrow",
      purchaseChannel: "okx_marketplace",
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

  const sessionKey = await buildSessionKey(request);
  try {
    assertDirectTaskOwner(task, sessionKey);
  } catch {
    return NextResponse.json({ ok: false, error: "Task access denied." }, { status: 403 });
  }

  const quoteId = task.input.quoteId;
  const quote = quoteId ? await getBoundQuote(quoteId) : null;
  const okxIdentity = getCanonicalOkxIdentity();

  const paymentModel =
    task.input.purchaseChannel === "okx_marketplace" ? "escrow" : "direct";

  return NextResponse.json({
    ok: true,
    task: formatA2ATaskResponse(task),
    quote: quote ? formatWorkflowQuote(quote, { paymentModel }) : null,
    aspAgentId: String(okxIdentity.aspAgentId),
    serviceId: String(okxIdentity.a2aServiceId),
    paymentModel,
    purchaseChannel: task.input.purchaseChannel ?? "okx_marketplace",
  });
}

/** Record an explicit direct-site scope or delivery decision. */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId: string;
      action?: "approve" | "approve_scope" | "accept_delivery" | "request_changes" | "reject_delivery";
      note?: string;
    };
    if (!body.taskId) {
      return NextResponse.json({ ok: false, error: "taskId is required." }, { status: 400 });
    }
    if (!body.action) {
      return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
    }

    const existing = await getA2ATask(body.taskId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
    }
    const sessionKey = await buildSessionKey(request);
    assertDirectTaskOwner(existing, sessionKey);

    const task =
      body.action === "approve" || body.action === "approve_scope"
        ? await approveA2ATask(body.taskId, true)
        : await reviewDirectSiteDelivery(body.taskId, {
            decision:
              body.action === "accept_delivery"
                ? "accept"
                : body.action === "request_changes"
                  ? "request_changes"
                  : "reject",
            note: body.note,
          });
    return NextResponse.json({ ok: true, task: formatA2ATaskResponse(task) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval failed.";
    return NextResponse.json(
      { ok: false, error: message === "task_access_denied" ? "Task access denied." : message },
      { status: message === "task_access_denied" ? 403 : 422 }
    );
  }
}
