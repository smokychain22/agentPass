import { NextResponse } from "next/server";
import {
  decodeAttestationStatement,
  getGreenPrAttestation,
  getGreenPrReceipt,
  getMaintenanceContractByDigest,
  trustedKeyMapFromEnvironment,
  verifyGreenPrAttestation,
} from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const attestationId =
    typeof body.attestationId === "string" ? body.attestationId.trim() : "";
  if (!attestationId) {
    return NextResponse.json(
      { success: false, error: "attestationId is required." },
      { status: 400 }
    );
  }
  const attestation = await getGreenPrAttestation(attestationId);
  if (!attestation) {
    return NextResponse.json(
      { success: false, error: "Green PR attestation not found." },
      { status: 404 }
    );
  }

  let statement;
  try {
    statement = decodeAttestationStatement(attestation);
  } catch {
    return NextResponse.json(
      { success: false, error: "Green PR attestation payload is invalid." },
      { status: 422 }
    );
  }
  const contract = await getMaintenanceContractByDigest(statement.predicate.contractDigest);
  if (!contract) {
    return NextResponse.json(
      { success: false, error: "Bound maintenance contract not found." },
      { status: 404 }
    );
  }
  const trustedPublicKeys = trustedKeyMapFromEnvironment("GREEN_PR");
  const trustedReceiptPublicKeys = trustedKeyMapFromEnvironment("RECEIPT");
  if (Object.keys(trustedPublicKeys).length === 0) {
    return NextResponse.json(
      { success: false, error: "Green PR verification trust root is not configured." },
      { status: 503 }
    );
  }
  const expected = body.expected && typeof body.expected === "object"
    ? body.expected as Record<string, unknown>
    : {};
  const receipt = await getGreenPrReceipt(statement.predicate.commercialEvidence.receiptId);
  const result = verifyGreenPrAttestation(attestation, {
    contractRecord: contract,
    trustedPublicKeys,
    expectedRepository:
      typeof expected.repository === "string" ? expected.repository : undefined,
    expectedSourceCommit:
      typeof expected.sourceCommit === "string" ? expected.sourceCommit : undefined,
    expectedPrHeadCommit:
      typeof expected.prHeadCommit === "string" ? expected.prHeadCommit : undefined,
    expectedPullRequestNumber:
      typeof expected.pullRequestNumber === "number" ? expected.pullRequestNumber : undefined,
    receipt,
    trustedReceiptPublicKeys,
  });
  return NextResponse.json(
    { success: result.valid, attestationId, ...result, statement: undefined },
    { status: result.valid ? 200 : 422, headers: { "Cache-Control": "no-store" } }
  );
}
