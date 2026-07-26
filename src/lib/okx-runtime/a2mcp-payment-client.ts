import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalRequestResource } from "@/lib/payment/a2mcp-request-binding";
import { REPODIET_OKX_SERVICES } from "./service-selection";

export interface CanonicalA2mcpRequest {
  url: string;
  method: "POST";
  contentType: "application/json";
  bodyText: string;
  body: Record<string, unknown>;
  bodyDigest: string;
  resource: string;
  operation: "analyze_repository";
  serviceId: "32948";
}

export interface X402AcceptedTerms {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  [key: string]: unknown;
}

export interface X402Challenge {
  x402Version: number;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: X402AcceptedTerms[];
}

export interface PaidReplayResponse {
  status: number;
  body: unknown;
  paymentResponse?: string;
  transactionReference?: string;
}

export interface A2mcpPaymentTransport {
  quote(request: CanonicalA2mcpRequest): Promise<X402Challenge>;
  authorize(input: {
    challenge: X402Challenge;
    accepted: X402AcceptedTerms;
    request: CanonicalA2mcpRequest;
  }): Promise<{ headerName: string; authorizationHeader: string }>;
  replay(input: {
    request: CanonicalA2mcpRequest;
    headerName: string;
    authorizationHeader: string;
  }): Promise<PaidReplayResponse>;
}

export interface PaymentExecutionRecord {
  requestDigest: string;
  state: "reserved" | "authorised" | "uncertain" | "settled";
  response?: PaidReplayResponse;
}

export interface PaymentExecutionStore {
  reserve(requestDigest: string): Promise<{ created: boolean; record?: PaymentExecutionRecord }>;
  save(record: PaymentExecutionRecord): Promise<void>;
}

function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function parseCanonicalBusinessRequest(input: {
  url: string;
  bodyText: string;
}): CanonicalA2mcpRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.bodyText);
  } catch {
    throw new Error("invalid_json_request");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(typeof parsed === "string" ? "double_encoded_json_request" : "invalid_json_request");
  }

  const body = parsed as Record<string, unknown>;
  if (typeof body.repositoryUrl !== "string" || typeof body.branch !== "string") {
    throw new Error("repository_and_branch_required");
  }
  const normalized = canonicalJson(body);
  return {
    url: input.url,
    method: "POST",
    contentType: "application/json",
    bodyText: input.bodyText,
    body,
    bodyDigest: `sha256:${createHash("sha256").update(normalized).digest("hex")}`,
    resource: canonicalRequestResource(input.url),
    operation: REPODIET_OKX_SERVICES.a2mcp.operation,
    serviceId: REPODIET_OKX_SERVICES.a2mcp.serviceId,
  };
}

export function decodePaymentRequired(value: string): X402Challenge {
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    throw new Error("payment_required_not_base64");
  }
  let challenge: X402Challenge;
  try {
    challenge = JSON.parse(decoded) as X402Challenge;
  } catch {
    throw new Error("payment_required_invalid_json");
  }
  if (challenge.x402Version !== 2 || !Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
    throw new Error("payment_required_invalid_shape");
  }
  return challenge;
}

export function selectProductionTerms(
  challenge: X402Challenge,
  request: CanonicalA2mcpRequest
): X402AcceptedTerms {
  if (canonicalRequestResource(challenge.resource.url) !== request.resource) {
    throw new Error("payment_resource_mismatch");
  }
  const accepted = challenge.accepts.find(
    (candidate) =>
      candidate.scheme === "exact" &&
      candidate.network === "eip155:196" &&
      candidate.asset.toLowerCase() === "0x779ded0c9e1022225f8e0630b35a9b54be713736" &&
      candidate.amount === "30000" &&
      candidate.payTo.toLowerCase() === "0x1339724ada3adf04bb7a8ccc6498216214bbdf90"
  );
  if (!accepted) throw new Error("canonical_payment_terms_missing");
  return accepted;
}

function executionDigest(request: CanonicalA2mcpRequest, accepted: X402AcceptedTerms): string {
  return `sha256:${createHash("sha256")
    .update(
      canonicalJson({
        amount: accepted.amount,
        asset: accepted.asset.toLowerCase(),
        bodyDigest: request.bodyDigest,
        branch: request.body.branch,
        method: request.method,
        network: accepted.network,
        operation: request.operation,
        payTo: accepted.payTo.toLowerCase(),
        repository: request.body.repositoryUrl,
        resource: request.resource,
        serviceId: request.serviceId,
      })
    )
    .digest("hex")}`;
}

function assertRequestIntegrity(request: CanonicalA2mcpRequest): void {
  const reparsed = parseCanonicalBusinessRequest({ url: request.url, bodyText: request.bodyText });
  if (
    reparsed.bodyDigest !== request.bodyDigest ||
    reparsed.resource !== request.resource ||
    reparsed.method !== request.method
  ) {
    throw new Error("request_binding_changed_before_replay");
  }
}

export async function executeCanonicalPaidReplay(input: {
  request: CanonicalA2mcpRequest;
  transport: A2mcpPaymentTransport;
  store: PaymentExecutionStore;
}): Promise<PaidReplayResponse & { idempotentReplay: boolean }> {
  const challenge = await input.transport.quote(input.request);
  const accepted = selectProductionTerms(challenge, input.request);
  const requestDigest = executionDigest(input.request, accepted);
  const reservation = await input.store.reserve(requestDigest);
  if (!reservation.created) {
    if (reservation.record?.state === "settled" && reservation.record.response) {
      return { ...reservation.record.response, idempotentReplay: true };
    }
    throw new Error(
      reservation.record?.state === "uncertain"
        ? "payment_state_uncertain_manual_reconciliation_required"
        : "payment_execution_already_in_progress"
    );
  }

  const authorization = await input.transport.authorize({
    challenge,
    accepted,
    request: input.request,
  });
  await input.store.save({ requestDigest, state: "authorised" });

  assertRequestIntegrity(input.request);
  if (executionDigest(input.request, selectProductionTerms(challenge, input.request)) !== requestDigest) {
    throw new Error("request_binding_changed_before_replay");
  }

  let response: PaidReplayResponse;
  try {
    response = await input.transport.replay({
      request: input.request,
      headerName: authorization.headerName,
      authorizationHeader: authorization.authorizationHeader,
    });
  } catch (error) {
    await input.store.save({ requestDigest, state: "uncertain" });
    throw error;
  }

  if (response.status !== 200 || (!response.paymentResponse && !response.transactionReference)) {
    await input.store.save({ requestDigest, state: "uncertain", response });
    throw new Error("settlement_receipt_missing");
  }
  await input.store.save({ requestDigest, state: "settled", response });
  return { ...response, idempotentReplay: false };
}

export class InMemoryPaymentExecutionStore implements PaymentExecutionStore {
  private readonly records = new Map<string, PaymentExecutionRecord>();

  async reserve(requestDigest: string) {
    const record = this.records.get(requestDigest);
    if (record) return { created: false, record };
    this.records.set(requestDigest, { requestDigest, state: "reserved" });
    return { created: true };
  }

  async save(record: PaymentExecutionRecord): Promise<void> {
    this.records.set(record.requestDigest, record);
  }
}

export class FilePaymentExecutionStore implements PaymentExecutionStore {
  constructor(private readonly file: string) {}

  private read(): Record<string, PaymentExecutionRecord> {
    if (!fs.existsSync(this.file)) return {};
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, PaymentExecutionRecord>;
  }

  async reserve(requestDigest: string) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = `${this.file}.${createHash("sha256").update(requestDigest).digest("hex")}.lock`;
    let handle: number | undefined;
    try {
      handle = fs.openSync(lock, "wx");
    } catch {
      const record = this.read()[requestDigest];
      return { created: false, record: record ?? { requestDigest, state: "reserved" as const } };
    }
    try {
      const records = this.read();
      if (records[requestDigest]) return { created: false, record: records[requestDigest] };
      records[requestDigest] = { requestDigest, state: "reserved" };
      atomicWrite(this.file, records);
      return { created: true };
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
      fs.rmSync(lock, { force: true });
    }
  }

  async save(record: PaymentExecutionRecord): Promise<void> {
    const records = this.read();
    records[record.requestDigest] = record;
    atomicWrite(this.file, records);
  }
}
