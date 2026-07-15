import { z } from "zod";
import { canonicalJson, sha256Digest } from "./canonical-json";
import {
  DSSE_PAYLOAD_TYPE,
  GREEN_PR_ALLOWED_OPERATIONS,
  GREEN_PR_PREDICATE_TYPE,
  IN_TOTO_STATEMENT_TYPE,
} from "./constants";
import {
  verifyMaintenanceContractRecord,
  type MaintenanceContractRecord,
} from "./contract";
import type { SignedGreenPrReceipt } from "./receipt";
import {
  signBytes,
  verifyBytes,
  type AsymmetricSigner,
  type DetachedSignature,
} from "./signatures";
import type {
  CommandResult,
  GreenPrVerificationDecision,
  IndependentVerificationInput,
  NamedCheckResult,
  VerificationStatus,
} from "./roles/verifier";
import { validateExecutionScope } from "./roles/executor";

export interface InTotoSubject {
  name: string;
  digest: { sha256: string };
}

export interface GreenPrAttestationPredicate {
  contractDigest: string;
  repository: string;
  pullRequest: { url: string; number: number; headCommit: string };
  sourceCommit: string;
  patchCommit: string;
  executorIdentity: "repodiet.executor/v1";
  verifierIdentity: "repodiet.verifier/v1";
  tools: Array<{ name: string; version: string; configurationDigest: string }>;
  findingsResolved: string[];
  filesChanged: IndependentVerificationInput["executorDispatch"]["changes"];
  verification: {
    checks: GreenPrVerificationDecision["checks"];
    baselineCommands: IndependentVerificationInput["baselineCommands"];
    patchedCommands: IndependentVerificationInput["patchedCommands"];
    newDiagnostics: string[];
    githubChecks: IndependentVerificationInput["githubChecks"];
    providerChecks: IndependentVerificationInput["providerChecks"];
    verifiedAt: string;
  };
  commercialEvidence: {
    aspId: number;
    serviceId: number;
    quoteId: string;
    taskId: string;
    paymentReference: string;
    receiptId: string;
    network: string;
    asset: string;
    amount: string;
  };
  result: {
    contractSatisfied: boolean;
    deliveryReady: boolean;
    acceptanceRecommendation: GreenPrVerificationDecision["acceptanceRecommendation"];
  };
}

export interface GreenPrInTotoStatement {
  _type: typeof IN_TOTO_STATEMENT_TYPE;
  subject: InTotoSubject[];
  predicateType: typeof GREEN_PR_PREDICATE_TYPE;
  predicate: GreenPrAttestationPredicate;
}

export interface DsseEnvelope {
  payloadType: typeof DSSE_PAYLOAD_TYPE;
  payload: string;
  signatures: Array<{ keyid: string; sig: string }>;
}

export interface GreenPrAttestationRecord {
  attestationId: string;
  statementDigest: string;
  envelope: DsseEnvelope;
  signatureMetadata: {
    keyId: string;
    keyVersion: string;
    algorithm: DetachedSignature["algorithm"];
    signedAt: string;
  };
  createdAt: string;
}

export interface GreenPrToolIdentity {
  name: string;
  version: string;
  configurationDigest: string;
}

const statementShape = z.object({
  _type: z.literal(IN_TOTO_STATEMENT_TYPE),
  subject: z.array(z.object({
    name: z.string(),
    digest: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  })).min(3),
  predicateType: z.literal(GREEN_PR_PREDICATE_TYPE),
  predicate: z.object({
    contractDigest: z.string(),
    repository: z.string(),
    pullRequest: z.object({ url: z.string().url(), number: z.number().int().positive(), headCommit: z.string() }),
    sourceCommit: z.string(),
    patchCommit: z.string(),
    executorIdentity: z.literal("repodiet.executor/v1"),
    verifierIdentity: z.literal("repodiet.verifier/v1"),
    tools: z.array(z.object({ name: z.string(), version: z.string(), configurationDigest: z.string() })),
    findingsResolved: z.array(z.string()),
    filesChanged: z.array(z.object({
      path: z.string(),
      operation: z.enum(GREEN_PR_ALLOWED_OPERATIONS),
      linesAdded: z.number(),
      linesDeleted: z.number(),
      dependencyChanges: z.number().optional(),
    })),
    verification: z.object({
      checks: z.array(z.object({ name: z.string(), passed: z.boolean(), reason: z.string().optional() })),
      baselineCommands: z.array(z.object({
        command: z.string(),
        status: z.enum(["passed", "failed", "skipped", "blocked", "unknown"]),
        diagnostics: z.array(z.string()).optional(),
      })),
      patchedCommands: z.array(z.object({
        command: z.string(),
        status: z.enum(["passed", "failed", "skipped", "blocked", "unknown"]),
        diagnostics: z.array(z.string()).optional(),
      })),
      newDiagnostics: z.array(z.string()),
      githubChecks: z.array(z.object({
        name: z.string(),
        status: z.enum(["passed", "failed", "skipped", "blocked", "unknown"]),
        url: z.string().optional(),
      })),
      providerChecks: z.array(z.object({
        name: z.string(),
        status: z.enum(["passed", "failed", "skipped", "blocked", "unknown"]),
        url: z.string().optional(),
      })).optional(),
      verifiedAt: z.string(),
    }),
    commercialEvidence: z.object({
      aspId: z.number(),
      serviceId: z.number(),
      quoteId: z.string(),
      taskId: z.string(),
      paymentReference: z.string(),
      receiptId: z.string(),
      network: z.string(),
      asset: z.string(),
      amount: z.string(),
    }),
    result: z.object({
      contractSatisfied: z.boolean(),
      deliveryReady: z.boolean(),
      acceptanceRecommendation: z.enum(["ACCEPT", "REJECT", "OWNER_REVIEW"]),
    }),
  }),
});

function artifactDigest(repository: string, kind: string, commit: string): string {
  return sha256Digest(`${repository}:${kind}:${commit}`).slice(7);
}

function requiredResultsPass(
  required: string[],
  results: Array<{ name: string; status: VerificationStatus }>,
  allowSkipped: boolean
): boolean {
  return required.every((requiredName) => {
    const result = results.find((candidate) => candidate.name === requiredName);
    return result?.status === "passed" || (allowSkipped && result?.status === "skipped");
  });
}

function commandResultsPass(
  required: string[],
  results: CommandResult[],
  allowSkipped: boolean
): boolean {
  return requiredResultsPass(
    required,
    results.map((result) => ({ name: result.command, status: result.status })),
    allowSkipped
  );
}

function subjectMatches(
  statement: GreenPrInTotoStatement,
  repository: string,
  kind: "source" | "patch" | "pr-head",
  commit: string
): boolean {
  const expectedName = `${repository}@${kind}:${commit}`;
  const expectedDigest = artifactDigest(repository, kind, commit);
  return statement.subject.some((subject) =>
    subject.name === expectedName && subject.digest.sha256 === expectedDigest
  );
}

function dssePae(payloadType: string, payload: Buffer): Buffer {
  const type = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, "utf8"),
    type,
    Buffer.from(` ${payload.length} `, "utf8"),
    payload,
  ]);
}

export function decodeAttestationStatement(
  record: GreenPrAttestationRecord
): GreenPrInTotoStatement {
  const payload = Buffer.from(record.envelope.payload, "base64").toString("utf8");
  return statementShape.parse(JSON.parse(payload)) as GreenPrInTotoStatement;
}

export function createGreenPrAttestation(input: {
  verificationInput: IndependentVerificationInput;
  decision: GreenPrVerificationDecision;
  receipt: SignedGreenPrReceipt;
  tools: GreenPrToolIdentity[];
  signer: AsymmetricSigner;
  now?: Date;
}): GreenPrAttestationRecord {
  if (input.decision.role !== "verifier" ||
      !input.decision.contractSatisfied ||
      input.decision.acceptanceRecommendation !== "ACCEPT") {
    throw new Error("green_pr_attestation_requires_verified_contract");
  }
  if (input.receipt.payload.contractDigest !== input.decision.contractDigest) {
    throw new Error("green_pr_attestation_receipt_contract_mismatch");
  }

  const now = input.now ?? new Date();
  const contract = input.verificationInput.contractRecord.contract;
  const repository = `${contract.repository.owner}/${contract.repository.name}`;
  const predicate: GreenPrAttestationPredicate = {
    contractDigest: input.decision.contractDigest,
    repository,
    pullRequest: input.verificationInput.pullRequest,
    sourceCommit: input.verificationInput.sourceCommit,
    patchCommit: input.verificationInput.patchCommit,
    executorIdentity: "repodiet.executor/v1",
    verifierIdentity: "repodiet.verifier/v1",
    tools: input.tools,
    findingsResolved: [...input.verificationInput.executorDispatch.findingIds].sort(),
    filesChanged: input.verificationInput.executorDispatch.changes,
    verification: {
      checks: input.decision.checks,
      baselineCommands: input.verificationInput.baselineCommands,
      patchedCommands: input.verificationInput.patchedCommands,
      newDiagnostics: input.decision.newDiagnostics,
      githubChecks: input.verificationInput.githubChecks,
      providerChecks: input.verificationInput.providerChecks ?? [],
      verifiedAt: input.decision.verifiedAt,
    },
    commercialEvidence: {
      aspId: contract.commercialTerms.aspId,
      serviceId: contract.commercialTerms.serviceId,
      quoteId: contract.commercialTerms.quoteId,
      taskId: input.receipt.payload.taskId,
      paymentReference: input.receipt.payload.paymentReference,
      receiptId: input.receipt.payload.receiptId,
      network: contract.commercialTerms.network,
      asset: contract.commercialTerms.asset,
      amount: contract.commercialTerms.amount,
    },
    result: {
      contractSatisfied: input.decision.contractSatisfied,
      deliveryReady: input.decision.deliveryReady,
      acceptanceRecommendation: input.decision.acceptanceRecommendation,
    },
  };
  const statement: GreenPrInTotoStatement = {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: [
      {
        name: `${repository}@source:${predicate.sourceCommit}`,
        digest: { sha256: artifactDigest(repository, "source", predicate.sourceCommit) },
      },
      {
        name: `${repository}@patch:${predicate.patchCommit}`,
        digest: { sha256: artifactDigest(repository, "patch", predicate.patchCommit) },
      },
      {
        name: `${repository}@pr-head:${predicate.pullRequest.headCommit}`,
        digest: { sha256: artifactDigest(repository, "pr-head", predicate.pullRequest.headCommit) },
      },
    ],
    predicateType: GREEN_PR_PREDICATE_TYPE,
    predicate,
  };
  const payload = Buffer.from(canonicalJson(statement), "utf8");
  const detached = signBytes(dssePae(DSSE_PAYLOAD_TYPE, payload), input.signer);
  const statementDigest = sha256Digest(payload);
  return {
    attestationId: `att_${statementDigest.slice(7, 31)}`,
    statementDigest,
    envelope: {
      payloadType: DSSE_PAYLOAD_TYPE,
      payload: payload.toString("base64"),
      signatures: [{ keyid: detached.keyId, sig: detached.signature }],
    },
    signatureMetadata: {
      keyId: detached.keyId,
      keyVersion: detached.keyVersion,
      algorithm: detached.algorithm,
      signedAt: now.toISOString(),
    },
    createdAt: now.toISOString(),
  };
}

export interface VerifyGreenPrAttestationOptions {
  contractRecord: MaintenanceContractRecord;
  trustedPublicKeys: Record<string, string>;
  expectedRepository?: string;
  expectedSourceCommit?: string;
  expectedPrHeadCommit?: string;
  expectedPullRequestNumber?: number;
  previouslyProcessedReceiptIds?: Set<string>;
}

export function verifyGreenPrAttestation(
  record: GreenPrAttestationRecord,
  options: VerifyGreenPrAttestationOptions
): {
  valid: boolean;
  signatureValid: boolean;
  contractSatisfied: boolean;
  sourceCommitMatched: boolean;
  scopeRespected: boolean;
  requiredChecksPassed: boolean;
  newDiagnostics: number;
  acceptanceRecommendation: "ACCEPT" | "REJECT";
  reasons: string[];
  statement?: GreenPrInTotoStatement;
} {
  const reasons: string[] = [];
  let statement: GreenPrInTotoStatement | undefined;
  const envelopeSignature = record.envelope.signatures[0];
  const trustedKey = envelopeSignature
    ? options.trustedPublicKeys[envelopeSignature.keyid]
    : undefined;
  const payload = Buffer.from(record.envelope.payload, "base64");
  const detached: DetachedSignature | undefined = envelopeSignature
    ? {
        keyId: envelopeSignature.keyid,
        keyVersion: record.signatureMetadata.keyVersion,
        algorithm: record.signatureMetadata.algorithm,
        signature: envelopeSignature.sig,
      }
    : undefined;
  if (envelopeSignature?.keyid !== record.signatureMetadata.keyId) {
    reasons.push("attestation_signature_metadata_mismatch");
  }
  const signatureValid = Boolean(
    trustedKey &&
    detached &&
    record.envelope.payloadType === DSSE_PAYLOAD_TYPE &&
    verifyBytes(dssePae(record.envelope.payloadType, payload), detached, trustedKey)
  );
  if (!signatureValid) reasons.push("attestation_signature_invalid");
  if (sha256Digest(payload) !== record.statementDigest) reasons.push("attestation_payload_digest_mismatch");

  try {
    statement = decodeAttestationStatement(record);
  } catch {
    reasons.push("attestation_statement_invalid");
  }

  const contractCheck = verifyMaintenanceContractRecord(options.contractRecord);
  if (!contractCheck.valid) reasons.push(contractCheck.reason ?? "contract_invalid");
  const contract = options.contractRecord.contract;
  const repository = `${contract.repository.owner}/${contract.repository.name}`;
  const predicate = statement?.predicate;

  if (predicate?.contractDigest !== options.contractRecord.contractDigest) {
    reasons.push("attestation_contract_mismatch");
  }
  if (predicate?.repository !== repository ||
      (options.expectedRepository && predicate?.repository !== options.expectedRepository)) {
    reasons.push("attestation_repository_mismatch");
  }
  const sourceCommitMatched = Boolean(
    predicate &&
    predicate.sourceCommit === contract.repository.sourceCommit &&
    (!options.expectedSourceCommit || predicate.sourceCommit === options.expectedSourceCommit)
  );
  if (!sourceCommitMatched) reasons.push("attestation_source_commit_mismatch");
  if (predicate?.pullRequest.headCommit !== predicate?.patchCommit ||
      (options.expectedPrHeadCommit && predicate?.pullRequest.headCommit !== options.expectedPrHeadCommit)) {
    reasons.push("attestation_pr_head_mismatch");
  }
  if (options.expectedPullRequestNumber &&
      predicate?.pullRequest.number !== options.expectedPullRequestNumber) {
    reasons.push("attestation_pull_request_mismatch");
  }
  if (predicate?.commercialEvidence.aspId !== contract.commercialTerms.aspId) {
    reasons.push("attestation_asp_mismatch");
  }
  if (predicate?.commercialEvidence.serviceId !== contract.commercialTerms.serviceId) {
    reasons.push("attestation_service_mismatch");
  }
  if (predicate?.commercialEvidence.quoteId !== contract.commercialTerms.quoteId) {
    reasons.push("attestation_quote_mismatch");
  }
  if (predicate?.commercialEvidence.network !== contract.commercialTerms.network ||
      predicate?.commercialEvidence.asset !== contract.commercialTerms.asset ||
      predicate?.commercialEvidence.amount !== contract.commercialTerms.amount) {
    reasons.push("attestation_payment_binding_mismatch");
  }
  if (predicate && options.previouslyProcessedReceiptIds?.has(predicate.commercialEvidence.receiptId)) {
    reasons.push("attestation_duplicate_receipt");
  }

  if (statement && predicate) {
    const subjectsValid =
      subjectMatches(statement, repository, "source", predicate.sourceCommit) &&
      subjectMatches(statement, repository, "patch", predicate.patchCommit) &&
      subjectMatches(statement, repository, "pr-head", predicate.pullRequest.headCommit);
    if (!subjectsValid) reasons.push("attestation_subject_digest_mismatch");
  }

  const scopeValidation = predicate
    ? validateExecutionScope(
        { ...options.contractRecord, status: "executing" },
        {
          contractDigest: predicate.contractDigest,
          sourceCommit: predicate.sourceCommit,
          findingIds: predicate.findingsResolved,
          changes: predicate.filesChanged,
        }
      )
    : undefined;
  const signedScopeCheck = predicate?.verification.checks.find(
    (entry) => entry.name === "scope"
  )?.passed;
  const scopeRespected = Boolean(scopeValidation?.valid && signedScopeCheck);
  if (!scopeRespected) {
    reasons.push(...(scopeValidation?.violations ?? ["attestation_scope_not_proven"]));
  }

  const allowSkipped = contract.verificationPolicy.allowSkippedChecks;
  const baselinePassed = Boolean(
    predicate &&
    (!contract.verificationPolicy.baselineRequired || commandResultsPass(
      contract.verificationPolicy.requiredCommands,
      predicate.verification.baselineCommands,
      allowSkipped
    ))
  );
  const patchedCommandsPassed = Boolean(
    predicate && commandResultsPass(
      contract.verificationPolicy.requiredCommands,
      predicate.verification.patchedCommands,
      allowSkipped
    )
  );
  const githubChecksPassed = Boolean(
    predicate && requiredResultsPass(
      contract.verificationPolicy.requiredGitHubChecks,
      predicate.verification.githubChecks as NamedCheckResult[],
      allowSkipped
    )
  );
  const diagnosticsPassed = Boolean(
    predicate &&
    (contract.verificationPolicy.allowNewDiagnostics ||
      predicate.verification.newDiagnostics.length === 0)
  );
  const signedChecksPassed = Boolean(
    predicate &&
    predicate.verification.checks.length > 0 &&
    predicate.verification.checks.every((entry) => entry.passed)
  );

  const requiredChecksPassed = Boolean(
    predicate &&
    baselinePassed &&
    patchedCommandsPassed &&
    githubChecksPassed &&
    diagnosticsPassed &&
    signedChecksPassed &&
    predicate.result.contractSatisfied &&
    predicate.result.deliveryReady &&
    predicate.result.acceptanceRecommendation === "ACCEPT"
  );
  if (!requiredChecksPassed) reasons.push("attestation_required_checks_failed");

  const valid = reasons.length === 0;
  return {
    valid,
    signatureValid,
    contractSatisfied: valid && Boolean(predicate?.result.contractSatisfied),
    sourceCommitMatched,
    scopeRespected,
    requiredChecksPassed,
    newDiagnostics: predicate?.verification.newDiagnostics.length ?? 0,
    acceptanceRecommendation: valid ? "ACCEPT" : "REJECT",
    reasons: [...new Set(reasons)],
    statement,
  };
}
