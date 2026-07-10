import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import type { FindingsPayload } from "@/lib/findings/types";
import {
  createCleanupPullRequest,
  createExecutionReceipt,
} from "@/lib/execution";
import {
  hashPatchContent,
  hashVerification,
} from "@/lib/operator/sign-receipt";
import { saveExecutionReceiptRecord } from "@/lib/store/product-store";
import type { PatchKitPayload } from "@/lib/patch-kit/types";

export async function executeCreateCleanupPr(body: unknown) {
  const input = ToolInputSchemas.createCleanupPr(body);
  const result = await createCleanupPullRequest({
    ...input,
    findings: input.findings as FindingsPayload | undefined,
    patchKit: input.patchKit as PatchKitPayload | undefined,
  });

  const baseCommitSha =
    (result.data.repo as { baseCommitSha?: string }).baseCommitSha ?? "unknown";

  const receipt = {
    taskId: `pr_${result.data.pullRequest.number}`,
    repository: `${result.data.repo.owner}/${result.data.repo.name}`,
    commitSha: baseCommitSha,
    findingIds: [],
    patchHash: hashPatchContent(JSON.stringify(result.data.actionSummary)),
    verificationHash: hashVerification(result.data.policy),
    status: "verified" as const,
    timestamp: new Date().toISOString(),
  };

  const signedReceipt = createExecutionReceipt(receipt);
  await saveExecutionReceiptRecord(signedReceipt);

  return {
    data: {
      ...result.data,
      signedReceipt,
    },
    warnings: result.warnings,
  };
}
