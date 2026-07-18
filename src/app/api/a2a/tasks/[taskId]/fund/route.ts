import { NextResponse } from "next/server";
import { fundA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { getA2aFundLock } from "@/lib/payment/payment-store";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { assertDirectTaskOwner } from "@/lib/workflow/task-access";
import {
  buildPreviewDryRunDenial,
  isPreviewPaymentBlocked,
} from "@/lib/deployment/preview-dry-run";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const body = (await request.json()) as {
    quoteId?: string;
    paymentReference?: string;
    payer?: string;
    paymentSignature?: string;
    idempotencyKey?: string;
  };

  try {
    if (isPreviewPaymentBlocked()) {
      return NextResponse.json(buildPreviewDryRunDenial(), { status: 403 });
    }

    const existing = await getA2ATask(taskId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
    }
    assertDirectTaskOwner(existing, await buildSessionKey(request));
    const task = await fundA2ATask(taskId, body, request);
    return NextResponse.json({
      success: task.status === "completed" || task.status === "awaiting_approval",
      ...formatA2ATaskResponse(task),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Funding failed.";
    if (message === "task_access_denied") {
      return NextResponse.json({ success: false, error: "Task access denied." }, { status: 403 });
    }
    if (message.includes("not awaiting payment")) {
      const task = await getA2ATask(taskId);
      const lock = await getA2aFundLock(taskId);
      if (task) {
        const paymentReference =
          task.input.paymentReference ??
          (typeof body.paymentReference === "string" ? body.paymentReference : undefined);
        return NextResponse.json(
          {
            success: task.status === "completed" || task.status === "awaiting_approval",
            alreadyProcessed: true,
            secondPayment: false,
            executionDispatched: Boolean(lock?.executionQueued),
            paymentReference,
            ...formatA2ATaskResponse(task),
          },
          { status: 200 }
        );
      }
    }
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
