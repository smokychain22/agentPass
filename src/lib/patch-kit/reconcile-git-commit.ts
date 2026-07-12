import { gitPathExistsAtRef } from "@/lib/github/fetch-repo-zip";
import type { ChangeOperation } from "./canonical-patch";
import type { ConsolidatedEdit } from "./merge-patches";

/** Drop operations/edits for paths that are not present at the scanned git commit. */
export async function reconcileEditsWithGitCommit(input: {
  owner: string;
  repo: string;
  baseCommitSha: string;
  edits: ConsolidatedEdit[];
  changeOperations: ChangeOperation[];
}): Promise<{
  edits: ConsolidatedEdit[];
  changeOperations: ChangeOperation[];
  droppedPaths: string[];
}> {
  const paths = [...new Set(input.changeOperations.map((op) => op.filePath))];
  const exists = new Map<string, boolean>();
  await Promise.all(
    paths.map(async (filePath) => {
      exists.set(
        filePath,
        await gitPathExistsAtRef(input.owner, input.repo, input.baseCommitSha, filePath)
      );
    })
  );

  const droppedPaths = paths.filter((p) => !exists.get(p));
  if (droppedPaths.length === 0) {
    return { edits: input.edits, changeOperations: input.changeOperations, droppedPaths };
  }

  const dropped = new Set(droppedPaths);
  return {
    edits: input.edits.filter((e) => exists.get(e.path) !== false),
    changeOperations: input.changeOperations.filter((op) => !dropped.has(op.filePath)),
    droppedPaths,
  };
}
