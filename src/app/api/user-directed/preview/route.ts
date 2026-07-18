import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppScan } from "@/lib/scan/app-scan-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { buildApplyableFilePatch } from "@/lib/patch-kit/applyable-patch-builder";
import { buildTextDiff } from "@/lib/execution/fix-preflight";
import { analyzeRequestedAction } from "@/lib/user-directed/analyze-requested-action";
import { normalizeTrackedPath, pathIdFor } from "@/lib/user-directed/path-identity";
import type {
  RequestedAction,
  RequestedActionType,
  TransformationPlan,
} from "@/lib/user-directed/types";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 180;

function redactSecrets(diff: string): { diff: string; redacted: boolean } {
  const patterns = [
    /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?([^\s"']+)/gi,
    /(sk-[a-zA-Z0-9]{20,})/g,
    /(ghp_[a-zA-Z0-9]{20,})/g,
  ];
  let out = diff;
  let redacted = false;
  for (const re of patterns) {
    const next = out.replace(re, (match) => {
      redacted = true;
      return match.replace(/[A-Za-z0-9_\-]{8,}/g, "[REDACTED]");
    });
    out = next;
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

/**
 * Isolated preflight → exact patch preview before payment.
 * No payable quote is created here; callers must POST /api/user-directed/quote after.
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
    const branch = findingsPayload?.repo.branch ?? scan?.payload.repo.branch ?? "main";
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

    const repoUrl = `https://github.com/${owner}/${repo}`;
    const workspace = await prepareRepoWorkspace(repoUrl, branch);
    try {
      const parts: string[] = [];
      const filesDeleted: string[] = [];
      const filesEdited: string[] = [];
      const filesCreated: string[] = [];
      const beforeHashes: string[] = [];
      let referencesChanged = 0;

      for (const rel of paths) {
        const abs = path.join(workspace.rootDir, rel);
        let original = "";
        try {
          original = await fs.readFile(abs, "utf8");
        } catch {
          // Missing at checkout — still invalid for delete
        }
        beforeHashes.push(
          createHash("sha256").update(original || rel).digest("hex").slice(0, 16)
        );

        if (actionType === "DELETE") {
          const applyable = buildApplyableFilePatch(rel, original || "", null);
          const fallback = buildTextDiff(rel, original || "\n", "");
          const piece = applyable || fallback;
          if (!piece.trim()) {
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
          // Bounded plan: propose a comment annotation — never execute arbitrary instructions.
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
        } else if (
          actionType === "CONSOLIDATE_DUPLICATES" ||
          actionType === "CHOOSE_CANONICAL"
        ) {
          const canonical = normalizeTrackedPath(
            body.canonicalPath ?? body.plan?.requestedActions[0]?.canonicalPath ?? paths[0]
          );
          if (rel === canonical) continue;
          const piece = buildApplyableFilePatch(rel, original || "", null);
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
        } else if (actionType === "INSPECT" || actionType === "KEEP" || actionType === "SUPPRESS") {
          return NextResponse.json({
            ok: true,
            payableQuoteAllowed: false,
            preview: null,
            message: "No repository write is planned for this action.",
          });
        } else {
          // Unsupported automatic transform → planning response, not silent skip
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
        // Fail-closed: DELETE is executable only when an eligible finding backs the path.
        // EDIT/CUSTOM may produce a bounded reviewable plan; payment still requires plan hash bind.
        transformerAvailable:
          actionType === "DELETE"
            ? relatedEligible
            : actionType === "EDIT" ||
                actionType === "CUSTOM" ||
                actionType === "CONSOLIDATE_DUPLICATES" ||
                actionType === "CHOOSE_CANONICAL",
        validationCommands: ["npm run typecheck", "npm run build"],
      });

      // Enrich file change stats on executable plans
      if (plan.executable) {
        plan.fileChanges = plan.fileChanges.map((c) => ({
          ...c,
          additions: c.action === "delete" ? 0 : additions,
          deletions: c.action === "delete" ? Math.max(1, Math.floor(deletions / Math.max(1, filesDeleted.length))) : deletions,
        }));
      }

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
    } finally {
      await workspace.cleanup();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preflight patch preview failed.";
    return NextResponse.json(
      { ok: false, error: message, payableQuoteAllowed: false },
      { status: 422 }
    );
  }
}
