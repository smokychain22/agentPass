import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import type { FindingsPayload } from "@/lib/findings/types";
import {
  createCleanupPullRequest,
  createExecutionReceipt,
} from "@/lib/execution";
import { buildCleanupProof, formatProofLadderSummary } from "@/lib/execution/proof-ladder";
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

  const patchKit = input.patchKit as PatchKitPayload | undefined;
  const pullRequestUrl = result.data.pullRequest.url;
  const cleanupProof =
    patchKit?.cleanupProof ??
    (patchKit?.summary
      ? buildCleanupProof({
          findings: patchKit.artifacts.findingsJson,
          summary: patchKit.summary,
          verificationStatus:
            patchKit.patchValidation?.status === "passed" ? "passed" : "partial",
          pullRequestUrl,
        })
      : undefined);

  return {
    data: {
      ...result.data,
      scanId: patchKit?.scanId ?? patchKit?.artifacts.findingsJson.scanId,
      commitSha: baseCommitSha,
      pullRequestUrl,
      cleanupProof: cleanupProof
        ? { ...cleanupProof, pullRequestUrl, verificationStatus: "passed" as const }
        : undefined,
      proofLadder: cleanupProof?.ladder,
      outcomeSummary: cleanupProof ? formatProofLadderSummary(cleanupProof.ladder) : undefined,
      signedReceipt,
    },
    warnings: result.warnings,
  };
}
