import { nanoid } from "nanoid";
import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { GuardRun, GuardSubscription } from "./types";

function subscriptionKey(repository: string): string {
  return `guard_sub_${repository}`;
}

export async function getGuardSubscription(
  repository: string
): Promise<GuardSubscription | undefined> {
  return getDurableRecord<GuardSubscription>("guard_runs", subscriptionKey(repository));
}

export async function saveGuardSubscription(
  subscription: GuardSubscription
): Promise<GuardSubscription> {
  await setDurableRecord("guard_runs", subscriptionKey(subscription.repository), subscription);
  return subscription;
}

export function newGuardSubscription(input: {
  repository: string;
  branch: string;
  quoteId?: string;
  paymentReference?: string;
  installationId?: string;
  priceUsdtMonthly?: number;
}): GuardSubscription {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nextWeekly = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    id: subscriptionKey(input.repository),
    recordType: "subscription",
    repository: input.repository,
    branch: input.branch,
    status: "active",
    installationId: input.installationId,
    quoteId: input.quoteId,
    paymentReference: input.paymentReference,
    priceUsdtMonthly: input.priceUsdtMonthly ?? 4,
    activatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nextWeeklyScanAt: nextWeekly.toISOString(),
    monthlyPrAllowanceRemaining: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function getGuardRun(runId: string): Promise<GuardRun | undefined> {
  return getDurableRecord<GuardRun>("guard_runs", runId);
}

export async function saveGuardRun(run: GuardRun): Promise<GuardRun> {
  await setDurableRecord("guard_runs", run.id, run);
  return run;
}

export function newGuardRun(input: {
  subscriptionId: string;
  repository: string;
  branch: string;
  trigger: GuardRun["trigger"];
  commitSha: string;
}): GuardRun {
  return {
    id: `guard_run_${nanoid(12)}`,
    recordType: "run",
    subscriptionId: input.subscriptionId,
    repository: input.repository,
    branch: input.branch,
    trigger: input.trigger,
    commitSha: input.commitSha,
    status: "scanning",
    createdAt: durableNow(),
  };
}

export async function updateSubscriptionAfterRun(
  subscription: GuardSubscription,
  run: GuardRun
): Promise<GuardSubscription> {
  const updated: GuardSubscription = {
    ...subscription,
    lastRunId: run.id,
    updatedAt: durableNow(),
  };
  if (run.currentScanId) {
    updated.lastAcceptedScanId = run.currentScanId;
    updated.lastAcceptedCommitSha = run.commitSha;
  }
  if (run.trigger === "weekly_scheduled") {
    const next = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    updated.nextWeeklyScanAt = next.toISOString();
  }
  return saveGuardSubscription(updated);
}
