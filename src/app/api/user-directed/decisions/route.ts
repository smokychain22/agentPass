import { NextResponse } from "next/server";
import {
  clearFindingDecision,
  listFindingDecisions,
  saveFindingDecision,
  type FindingDecisionState,
} from "@/lib/user-directed/decision-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { riskBucketOf } from "@/lib/findings/cleanup-eligibility";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_DECISIONS: FindingDecisionState[] = [
  "undecided",
  "selected",
  "kept",
  "excluded",
  "verification_requested",
  "verified_selected",
  "verified_kept",
];

export async function GET(request: Request) {
  const scanId = new URL(request.url).searchParams.get("scanId");
  if (!scanId) {
    return NextResponse.json({ ok: false, error: "scanId is required." }, { status: 400 });
  }
  const decisions = await listFindingDecisions(scanId);
  return NextResponse.json({ ok: true, scanId, decisions });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    scanId?: string;
    findingId?: string;
    decision?: string;
    analyzedCommit?: string;
    canonicalFile?: string;
    filesToRemove?: string[];
    filesToKeep?: string[];
    isOverride?: boolean;
  };

  if (!body.scanId || !body.findingId) {
    return NextResponse.json(
      { ok: false, error: "scanId and findingId are required." },
      { status: 400 }
    );
  }
  if (!body.decision || !VALID_DECISIONS.includes(body.decision as FindingDecisionState)) {
    return NextResponse.json(
      { ok: false, error: `decision must be one of: ${VALID_DECISIONS.join(", ")}` },
      { status: 400 }
    );
  }

  // Never trust client-supplied findingId/files/commit — derive everything
  // allowed from the persisted findings payload for this exact scan.
  const findingsPayload = await getStoredFindings(body.scanId);
  if (!findingsPayload) {
    return NextResponse.json(
      { ok: false, error: "Findings not found for scanId — the scan is stale or unknown." },
      { status: 404 }
    );
  }
  if (
    body.analyzedCommit &&
    findingsPayload.repo.commitSha &&
    body.analyzedCommit !== findingsPayload.repo.commitSha
  ) {
    return NextResponse.json(
      { ok: false, error: "The analyzed commit no longer matches this scan's findings." },
      { status: 409 }
    );
  }

  const finding = flattenFindings(findingsPayload).find((f) => f.id === body.findingId);
  if (!finding) {
    return NextResponse.json(
      { ok: false, error: "This finding is not present in the stored findings for this scan." },
      { status: 404 }
    );
  }

  if (
    (body.decision === "selected" || body.decision === "verified_selected") &&
    riskBucketOf(finding) === "PROTECTED"
  ) {
    return NextResponse.json(
      { ok: false, error: "This finding is protected — RepoDiet will not modify it directly." },
      { status: 403 }
    );
  }

  // Command 3E, Part 1/8: a finding can only be selected when RepoDiet has a
  // real, implemented transformation for it — never inferred from the
  // detector's own output. Findings persisted before this split (no
  // detectionType) fall back to the riskBucket check above only.
  if (
    (body.decision === "selected" || body.decision === "verified_selected") &&
    finding.detectionType &&
    !finding.supportedTransformationId
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "RepoDiet has no implemented transformation for this finding — it cannot be selected.",
      },
      { status: 403 }
    );
  }

  const allowedFiles = new Set(finding.files);
  const clientFileArrays: Array<[string, string[] | undefined]> = [
    ["canonicalFile", body.canonicalFile ? [body.canonicalFile] : undefined],
    ["filesToRemove", body.filesToRemove],
    ["filesToKeep", body.filesToKeep],
  ];
  for (const [field, values] of clientFileArrays) {
    if (values?.some((f) => !allowedFiles.has(f))) {
      return NextResponse.json(
        { ok: false, error: `${field} contains a file not present on the stored finding.` },
        { status: 400 }
      );
    }
  }
  if (body.canonicalFile && finding.type !== "duplicate_code") {
    return NextResponse.json(
      { ok: false, error: "canonicalFile is only valid for duplicate_code findings." },
      { status: 400 }
    );
  }

  const record = await saveFindingDecision({
    scanId: body.scanId,
    findingId: body.findingId,
    decision: body.decision as FindingDecisionState,
    analyzedCommit: findingsPayload.repo.commitSha,
    canonicalFile: body.canonicalFile,
    filesToRemove: body.filesToRemove,
    filesToKeep: body.filesToKeep,
    isOverride: body.isOverride,
  });

  return NextResponse.json({ ok: true, decision: record });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const scanId = url.searchParams.get("scanId");
  const findingId = url.searchParams.get("findingId");
  if (!scanId || !findingId) {
    return NextResponse.json(
      { ok: false, error: "scanId and findingId are required." },
      { status: 400 }
    );
  }
  await clearFindingDecision(scanId, findingId);
  return NextResponse.json({ ok: true });
}
