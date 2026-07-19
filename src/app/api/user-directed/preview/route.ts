import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppScan } from "@/lib/scan/app-scan-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { buildApplyableFilePatch } from "@/lib/patch-kit/applyable-patch-builder";
import { analyzeRequestedAction } from "@/lib/user-directed/analyze-requested-action";
import { normalizeTrackedPath, pathIdFor } from "@/lib/user-directed/path-identity";
import type {
  RequestedAction,
  RequestedActionType,
  TransformationPlan,
} from "@/lib/user-directed/types";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const maxDuration = 60;

function redactSecrets(diff: string): { diff: string; redacted: boolean } {
  const patterns = [
    /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?([^\s"']+)/gi,
    /(sk-[a-zA-Z0-9]{20,})/g,
    /(ghp_[a-zA-Z0-9]{20,})/g,
  ];
  let out = diff;
  let redacted = false;
  for (const re of patterns) {
    out = out.replace(re, (match) => {
      redacted = true;
      return match.replace(/[A-Za-z0-9_\-]{8,}/g, "[REDACTED]");
    });
  }
  return { diff: out, redacted };
}

function countLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

async function fetchPinnedFileContent(input: {
  owner: string;
  repo: string;
  commitSha: string;
  path: string;
}): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${input.commitSha}/${input.path}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/plain", "User-Agent": "RepoDiet-preflight" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Lightweight pre-payment patch preview (no full workspace checkout).
 * Uses pinned-commit file contents from GitHub + applyable unified diffs.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      scanId?: string;
      repository?: string;
      pinnedCommit?: string;
      selectedRepositoryPaths?: string[];
      selectedFindingIds?: string[];
      actionType?: RequestedActionType;
      userInstruction?: string;
      canonicalPath?: string;
      requestedBy?: string;
      plan?: TransformationPlan;
    };

    const scanId = body.scanId;
    if (!scanId) {
      return NextResponse.json({ ok: false, error: "scanId is required." }, { status: 400 });
    }

    const scan = await getAppScan(scanId);
    const findingsPayload = await getStoredFindings(scanId);
    const owner = findingsPayload?.repo.owner ?? scan?.payload.repo.owner;
    const repo = findingsPayload?.repo.name ?? scan?.payload.repo.name;
    const pinnedCommit =
      body.pinnedCommit ?? findingsPayload?.repo.commitSha ?? scan?.payload.repo.commitSha;
    const repository = body.repository ?? (owner && repo ? `${owner}/${repo}` : undefined);

    if (!owner || !repo || !pinnedCommit || !repository) {
      return NextResponse.json(
        { ok: false, error: "Pinned repository commit is required for preflight." },
        { status: 404 }
      );
    }

    const flat = findingsPayload ? flattenFindings(findingsPayload) : [];
    const findingIds = body.selectedFindingIds ?? body.plan?.selectedFindingIds ?? [];
    const fromFindings = flat
      .filter((f) => findingIds.includes(f.id))
      .flatMap((f) => f.files.map(normalizeTrackedPath));
    const paths = [
      ...new Set([
        ...(body.selectedRepositoryPaths ?? body.plan?.selectedRepositoryPaths ?? []).map(
          normalizeTrackedPath
        ),
        ...fromFindings,
      ]),
    ];

    if (paths.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Select at least one path for patch preview." },
        { status: 400 }
      );
    }

    const actionType: RequestedActionType =
      body.actionType ?? body.plan?.proposedAction ?? "DELETE";

    if (actionType === "INSPECT" || actionType === "KEEP" || actionType === "SUPPRESS") {
      return NextResponse.json({
        ok: true,
        payableQuoteAllowed: false,
        preview: null,
        message: "No repository write is planned for this action.",
      });
    }

    if (
      actionType !== "DELETE" &&
      actionType !== "EDIT" &&
      actionType !== "CUSTOM" &&
      actionType !== "CONSOLIDATE_DUPLICATES" &&
      actionType !== "CHOOSE_CANONICAL"
    ) {
      const action: RequestedAction = {
        id: `req_${nanoid(10)}`,
        repository,
        pinnedCommit,
        pathIds: paths.map(pathIdFor),
        findingIds,
        actionType,
        userInstruction: body.userInstruction,
        canonicalPath: body.canonicalPath,
        requestedAt: new Date().toISOString(),
        requestedBy: body.requestedBy ?? "workspace_user",
      };
      const plan = analyzeRequestedAction({
        action,
        findings: flat,
        transformerAvailable: false,
      });
      return NextResponse.json({
        ok: true,
        payableQuoteAllowed: false,
        transformationPlans: [plan],
        message: plan.summary,
        nextStep: plan.nextStep,
      });
    }

    const parts: string[] = [];
    const filesDeleted: string[] = [];
    const filesEdited: string[] = [];
    const filesCreated: string[] = [];
    const beforeHashes: string[] = [];
    let referencesChanged = 0;

    for (const rel of paths) {
      const original =
        (await fetchPinnedFileContent({
          owner,
          repo,
          commitSha: pinnedCommit,
          path: rel,
        })) ?? "";
      beforeHashes.push(createHash("sha256").update(original || rel).digest("hex").slice(0, 16));

      if (actionType === "DELETE") {
        const piece = buildApplyableFilePatch(rel, original || "\n", null);
        if (!piece?.trim()) {
          return NextResponse.json(
            {
              ok: false,
              error: `Preflight could not produce a real delete patch for ${rel}.`,
              payableQuoteAllowed: false,
            },
            { status: 422 }
          );
        }
        parts.push(piece);
        filesDeleted.push(rel);
      } else if (actionType === "EDIT" || actionType === "CUSTOM") {
        const instruction = body.userInstruction ?? "";
        const annotated =
          original +
          (original.endsWith("\n") ? "" : "\n") +
          `// RepoDiet planned edit (review required): ${instruction.slice(0, 200)}\n`;
        const piece = buildApplyableFilePatch(rel, original, annotated);
        if (!piece) {
          return NextResponse.json(
            {
              ok: false,
              error: `Preflight could not produce a bounded edit plan for ${rel}.`,
              payableQuoteAllowed: false,
            },
            { status: 422 }
          );
        }
        parts.push(piece);
        filesEdited.push(rel);
      } else {
        const canonical = normalizeTrackedPath(
          body.canonicalPath ?? body.plan?.requestedActions[0]?.canonicalPath ?? paths[0]
        );
        if (rel === canonical) continue;
        const piece = buildApplyableFilePatch(rel, original || "\n", null);
        if (!piece) {
          return NextResponse.json(
            {
              ok: false,
              error: `Preflight could not produce consolidation patch for ${rel}.`,
              payableQuoteAllowed: false,
            },
            { status: 422 }
          );
        }
        parts.push(piece);
        filesDeleted.push(rel);
        referencesChanged += 1;
      }
    }

    const rawDiff = parts.join("\n");
    if (!rawDiff.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Preflight produced an empty patch; no payable quote may be created.",
          payableQuoteAllowed: false,
        },
        { status: 422 }
      );
    }

    const { diff: unifiedDiff, redacted } = redactSecrets(rawDiff);
    const { additions, deletions } = countLines(unifiedDiff);
    const beforeHash = createHash("sha256").update(beforeHashes.join("|")).digest("hex");
    const afterHash = createHash("sha256").update(unifiedDiff).digest("hex");

    const action: RequestedAction = {
      id: `req_${nanoid(10)}`,
      repository,
      pinnedCommit,
      pathIds: paths.map(pathIdFor),
      findingIds,
      actionType,
      userInstruction: body.userInstruction,
      canonicalPath: body.canonicalPath,
      requestedAt: new Date().toISOString(),
      requestedBy: body.requestedBy ?? "workspace_user",
    };

    const relatedEligible = flat.some(
      (f) =>
        f.files.some((file) => paths.includes(normalizeTrackedPath(file))) &&
        (f.action === "safe_candidate" ||
          (f.evidence.signals ?? []).includes("classification=actionable_candidate"))
    );

    const plan = analyzeRequestedAction({
      action,
      findings: flat,
      unifiedDiff,
      transformerAvailable:
        actionType === "DELETE"
          ? relatedEligible
          : actionType === "EDIT" ||
            actionType === "CUSTOM" ||
            actionType === "CONSOLIDATE_DUPLICATES" ||
            actionType === "CHOOSE_CANONICAL",
      validationCommands: ["npm run typecheck", "npm run build"],
    });

    const preview = {
      planId: plan.planId,
      unifiedDiff,
      filesCreated,
      filesEdited,
      filesDeleted,
      filesRenamed: [] as Array<{ from: string; to: string }>,
      referencesChanged,
      dependenciesChanged: [] as string[],
      beforeHash,
      afterHash,
      additions,
      deletions,
      validationCommands: plan.validationCommands,
      predictedValidationSeconds: plan.predictedValidationSeconds ?? 90,
      unexpectedChangeBudget: plan.unexpectedChangeBudget,
      rollbackPlan: plan.rollbackPlan,
      secretsRedacted: redacted,
      normalizedPatchHash: plan.normalizedPatchHash,
    };

    return NextResponse.json({
      ok: true,
      payableQuoteAllowed: Boolean(plan.executable && plan.normalizedPatchHash),
      preview,
      transformationPlans: [plan],
      requestedAction: action,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preflight patch preview failed.";
    return NextResponse.json(
      { ok: false, error: message, payableQuoteAllowed: false },
      { status: 422 }
    );
  }
}
