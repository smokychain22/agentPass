import type { Finding } from "@/lib/findings/types";
import { runFixPreflight } from "@/lib/execution/fix-preflight";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";

export interface TransformPreflightFindingResult {
  findingId: string;
  passed: boolean;
  sourceHash?: string;
  transformedHash?: string;
  blocker?: string;
  protectedPath?: boolean;
}

export interface TransformPreflightResult {
  passed: TransformPreflightFindingResult[];
  failed: TransformPreflightFindingResult[];
  transformedSourceHashes: Record<string, string>;
  allPassed: boolean;
}

export async function runTransformPreflightForQuote(input: {
  repoUrl: string;
  branch?: string;
  findings: Finding[];
  findingIds: string[];
}): Promise<TransformPreflightResult> {
  const selected = input.findings.filter((f) => input.findingIds.includes(f.id));
  const workspace = await prepareRepoWorkspace(input.repoUrl, input.branch);

  const passed: TransformPreflightFindingResult[] = [];
  const failed: TransformPreflightFindingResult[] = [];
  const transformedSourceHashes: Record<string, string> = {};

  try {
    for (const finding of selected) {
      const protectedPath = finding.files.some((f) => isDoNotTouchPath(f));
      if (protectedPath || finding.protected || finding.action === "do_not_touch") {
        failed.push({
          findingId: finding.id,
          passed: false,
          protectedPath: true,
          blocker: "Protected path cannot be modified.",
        });
        continue;
      }

      const preflight = await runFixPreflight(workspace.rootDir, finding);
      const ok =
        preflight.classification === "actionable_candidate" &&
        preflight.diffGenerated === true &&
        preflight.sourceHashMatches === true &&
        preflight.protectedPathCheck === true &&
        Boolean(preflight.proposedModifiedHash) &&
        Boolean(preflight.proposedDiff?.trim());

      const entry: TransformPreflightFindingResult = {
        findingId: finding.id,
        passed: ok,
        sourceHash: preflight.sourceHash,
        transformedHash: preflight.proposedModifiedHash,
        blocker: preflight.blocker,
        protectedPath: !preflight.protectedPathCheck,
      };

      if (ok && preflight.proposedModifiedHash) {
        transformedSourceHashes[finding.id] = preflight.proposedModifiedHash;
        passed.push(entry);
      } else {
        failed.push(entry);
      }
    }
  } finally {
    await workspace.cleanup();
  }

  return {
    passed,
    failed,
    transformedSourceHashes,
    allPassed: passed.length > 0 && failed.length === 0,
  };
}
