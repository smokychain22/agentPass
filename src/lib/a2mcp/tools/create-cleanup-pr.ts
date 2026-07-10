import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import type { FindingsPayload } from "@/lib/findings/types";
import { createCleanupPullRequestFromEngine } from "@/lib/execution/cleanup-engine";
import {
  hashPatchContent,
  hashVerification,
  signExecutionReceipt,
} from "@/lib/operator/sign-receipt";
import type { PatchKitPayload } from "@/lib/patch-kit/types";

export async function executeCreateCleanupPr(body: unknown) {
  const input = ToolInputSchemas.createCleanupPr(body);
  const result = await createCleanupPullRequestFromEngine({
    ...input,
    findings: input.findings as FindingsPayload | undefined,
    patchKit: input.patchKit as PatchKitPayload | undefined,
  });

  const receipt = {
    taskId: `pr_${result.data.pullRequest.number}`,
    repository: `${result.data.repo.owner}/${result.data.repo.name}`,
    commitSha: "pr-head",
    findingIds: [],
    patchHash: hashPatchContent(JSON.stringify(result.data.actionSummary)),
    verificationHash: hashVerification(result.data.policy),
    status: "verified" as const,
    timestamp: new Date().toISOString(),
  };

  const signedReceipt = signExecutionReceipt(receipt);

  return {
    ...result,
    signedReceipt,
  };
}
