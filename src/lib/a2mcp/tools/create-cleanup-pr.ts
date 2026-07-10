import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import type { FindingsPayload } from "@/lib/findings/types";
import { createCleanupPullRequest } from "@/lib/operator/create-cleanup-pr";
import type { PatchKitPayload } from "@/lib/patch-kit/types";

export async function executeCreateCleanupPr(body: unknown) {
  const input = ToolInputSchemas.createCleanupPr(body);
  return createCleanupPullRequest({
    ...input,
    findings: input.findings as FindingsPayload | undefined,
    patchKit: input.patchKit as PatchKitPayload | undefined,
  });
}
