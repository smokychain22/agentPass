import { NextRequest, NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import {
  buildDeliveryReceiptChecks,
  inspectPullRequestChecks,
  retryFailedPrChecks,
} from "@/lib/github/pr-check-monitor";
import {
  getPrDeliveryMonitor,
  getPrDeliveryMonitorByTaskId,
} from "@/lib/github/pr-delivery-store";
import { getA2ATask } from "@/lib/a2a/task-store";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { assertDirectTaskOwner } from "@/lib/workflow/task-access";

export const runtime = "nodejs";
export const maxDuration = 120;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export async function GET(request: NextRequest) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { ok: false, error: "GitHub App is not configured on this deployment." },
      { status: 503, headers: NO_STORE }
    );
  }

  const params = request.nextUrl.searchParams;
  const owner = params.get("owner")?.trim();
  const repo = params.get("repo")?.trim();
  const prNumberRaw = params.get("prNumber") ?? params.get("pr");
  const taskId = params.get("taskId")?.trim();
  const installationIdRaw = params.get("installation_id") ?? params.get("github_installation_id");
  const installationId = installationIdRaw ? Number(installationIdRaw) : undefined;
  const poll = params.get("poll") === "true";

  if (taskId) {
    const task = await getA2ATask(taskId);
    if (task) {
      try {
        assertDirectTaskOwner(task, await buildSessionKey(request));
      } catch {
        return NextResponse.json(
          { ok: false, error: "Task access denied." },
          { status: 403, headers: NO_STORE }
        );
      }
    }
  }

  if (taskId) {
    const existing = await getPrDeliveryMonitorByTaskId(taskId);
    if (existing) {
      return NextResponse.json(
        {
          ok: true,
          monitor: existing,
          receiptChecks: buildDeliveryReceiptChecks(existing),
        },
        { headers: NO_STORE }
      );
    }
  }

  if (!owner || !repo || !prNumberRaw) {
    return NextResponse.json(
      { ok: false, error: "owner, repo, and prNumber are required." },
      { status: 400, headers: NO_STORE }
    );
  }

  const prNumber = Number(prNumberRaw);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return NextResponse.json(
      { ok: false, error: "prNumber must be a positive integer." },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const monitor = await inspectPullRequestChecks({
      owner,
      repo,
      prNumber,
      taskId,
      installationId:
        installationId && Number.isFinite(installationId) ? installationId : undefined,
      poll,
      maxPollAttempts: poll ? 8 : 1,
    });

    return NextResponse.json(
      {
        ok: true,
        monitor,
        receiptChecks: buildDeliveryReceiptChecks(monitor),
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to inspect pull request checks.";
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { ok: false, error: "GitHub App is not configured on this deployment." },
      { status: 503, headers: NO_STORE }
    );
  }

  const body = (await request.json()) as {
    action?: "inspect" | "retry";
    owner?: string;
    repo?: string;
    prNumber?: number;
    taskId?: string;
    installationId?: number;
    poll?: boolean;
  };

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  const prNumber = body.prNumber;
  if (body.taskId) {
    const task = await getA2ATask(body.taskId);
    if (task) {
      try {
        assertDirectTaskOwner(task, await buildSessionKey(request));
      } catch {
        return NextResponse.json(
          { ok: false, error: "Task access denied." },
          { status: 403, headers: NO_STORE }
        );
      }
    }
  }
  if (!owner || !repo || !prNumber) {
    return NextResponse.json(
      { ok: false, error: "owner, repo, and prNumber are required." },
      { status: 400, headers: NO_STORE }
    );
  }

  if (body.action === "retry") {
    const result = await retryFailedPrChecks({
      owner,
      repo,
      prNumber,
      installationId: body.installationId,
    });
    const monitor = await inspectPullRequestChecks({
      owner,
      repo,
      prNumber,
      taskId: body.taskId,
      installationId: body.installationId,
      poll: false,
    });
    return NextResponse.json(
      { ok: true, ...result, monitor, receiptChecks: buildDeliveryReceiptChecks(monitor) },
      { headers: NO_STORE }
    );
  }

  const monitor = await inspectPullRequestChecks({
    owner,
    repo,
    prNumber,
    taskId: body.taskId,
    installationId: body.installationId,
    poll: body.poll === true,
    maxPollAttempts: body.poll ? 10 : 1,
  });

  return NextResponse.json(
    {
      ok: true,
      monitor,
      receiptChecks: buildDeliveryReceiptChecks(monitor),
    },
    { headers: NO_STORE }
  );
}
