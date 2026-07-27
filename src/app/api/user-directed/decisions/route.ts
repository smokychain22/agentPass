import { NextResponse } from "next/server";
import {
  listFindingDecisions,
  saveFindingDecision,
  type FindingDecisionState,
} from "@/lib/user-directed/decision-store";

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

  const record = await saveFindingDecision({
    scanId: body.scanId,
    findingId: body.findingId,
    decision: body.decision as FindingDecisionState,
    analyzedCommit: body.analyzedCommit,
    canonicalFile: body.canonicalFile,
    filesToRemove: body.filesToRemove,
    filesToKeep: body.filesToKeep,
  });

  return NextResponse.json({ ok: true, decision: record });
}
