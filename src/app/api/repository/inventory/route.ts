import { NextResponse } from "next/server";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { getAppScan } from "@/lib/scan/app-scan-store";
import { loadPinnedCommitTree } from "@/lib/coverage/git-tree-inventory";
import { flattenFindings } from "@/lib/findings/client";
import { inventoryNodesFromTree } from "@/lib/user-directed/inventory";
import { normalizeTrackedPath } from "@/lib/user-directed/path-identity";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Authoritative pinned-commit tracked path inventory for Repository Explorer.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scanId = url.searchParams.get("scanId");
  if (!scanId) {
    return NextResponse.json({ ok: false, error: "scanId is required." }, { status: 400 });
  }

  try {
    const scan = await getAppScan(scanId);
    const findings = await getStoredFindings(scanId);
    const owner = findings?.repo.owner ?? scan?.payload.repo.owner;
    const repo = findings?.repo.name ?? scan?.payload.repo.name;
    const commitSha = findings?.repo.commitSha ?? scan?.payload.repo.commitSha;
    const branch = findings?.repo.branch ?? scan?.payload.repo.branch;

    if (!owner || !repo || !commitSha) {
      return NextResponse.json(
        { ok: false, error: "Pinned repository commit is not available for this scan." },
        { status: 404 }
      );
    }

    const tree = await loadPinnedCommitTree({
      owner,
      repo,
      commitSha,
    });

    const findingPathIndex = new Map<string, string[]>();
    if (findings) {
      for (const finding of flattenFindings(findings)) {
        for (const file of finding.files) {
          const key = normalizeTrackedPath(file);
          const list = findingPathIndex.get(key) ?? [];
          list.push(finding.id);
          findingPathIndex.set(key, list);
        }
      }
    }

    const nodes = inventoryNodesFromTree(tree.entries, { findingPathIndex });
    const blobCount = nodes.filter((n) => n.type === "blob").length;

    return NextResponse.json({
      ok: true,
      repository: `${owner}/${repo}`,
      branch,
      pinnedCommit: commitSha,
      treeSha: tree.treeSha,
      totalPaths: blobCount,
      nodes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load repository inventory.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
