/** Deterministic OKX facilitator contract tests. No network calls or funds. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  A2mcpX402Error,
  decodePaymentSignatureHeader,
  OkxX402Broker,
  type FacilitatorDiagnostic,
  type X402PaymentPayloadV2,
} from "../src/lib/payment/a2mcp-x402-production";

const RESOURCE = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage";
const ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const SELLER = "0x1339724ada3adf04bb7a8ccc6498216214bbdf90";
const BUYER = "0x1111111111111111111111111111111111111111";
const NOW = "2026-07-22T10:11:12.000Z";
const SECRET = "facilitator-secret-value";
const ENV = {
  NODE_ENV: "test",
  OKX_API_KEY: "api-key-value",
  OKX_SECRET_KEY: SECRET,
  OKX_PASSPHRASE: "passphrase-value",
  REPODIET_X402_FACILITATOR_URL: "https://web3.okx.com",
} satisfies NodeJS.ProcessEnv;

function payment(): X402PaymentPayloadV2 {
  return {
    x402Version: 2,
    resource: { url: RESOURCE, description: "RepoDiet triage", mimeType: "application/json" },
    accepted: {
      scheme: "exact",
      network: "eip155:196",
      asset: ASSET,
      amount: "30000",
      payTo: SELLER,
      maxTimeoutSeconds: 300,
      extra: { name: "USD₮0", version: "1", quoteId: "quote_1" },
    },
    payload: {
      signature: `0x${"12".repeat(65)}`,
      authorization: {
        from: BUYER,
        to: SELLER,
        value: "30000",
        validAfter: "1784714800",
        validBefore: "1784715100",
        nonce: `0x${"ab".repeat(32)}`,
      },
    },
  };
}

function requirements() {
  return {
    scheme: "exact",
    network: "eip155:196",
    asset: ASSET,
    amount: "30000",
    payTo: SELLER,
    maxTimeoutSeconds: 300,
    extra: { name: "USD₮0", version: "1", quoteId: "quote_1" },
  };
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function expectCode(work: () => Promise<unknown> | unknown, code: string) {
  await assert.rejects(
    async () => work(),
    (error: unknown) => error instanceof A2mcpX402Error && error.code === code
  );
}

async function test(name: string, work: () => Promise<void> | void) {
  await work();
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("a2mcp-facilitator-diagnostics");

  await test("v1, missing accepted, accepts[], and mixed authorization types fail closed", async () => {
    const v1 = payment() as unknown as Record<string, unknown>;
    v1.x402Version = 1;
    await expectCode(() => decodePaymentSignatureHeader(encoded(v1)), "PAYMENT_PAYLOAD_INVALID");

    const missing = payment() as unknown as Record<string, unknown>;
    delete missing.accepted;
    await expectCode(() => decodePaymentSignatureHeader(encoded(missing)), "PAYMENT_PAYLOAD_INVALID");

    const accepts = payment() as unknown as Record<string, unknown>;
    accepts.accepts = [accepts.accepted];
    delete accepts.accepted;
    await expectCode(() => decodePaymentSignatureHeader(encoded(accepts)), "PAYMENT_PAYLOAD_INVALID");

    const mixed = payment() as unknown as { payload: Record<string, unknown> };
    mixed.payload.permit2Authorization = {};
    await expectCode(() => decodePaymentSignatureHeader(encoded(mixed)), "PAYMENT_PAYLOAD_INVALID");
  });

  await test("verify uses the current route and signs the exact bytes sent", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ code: "0", msg: "", data: { isValid: true, payer: BUYER } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const broker = new OkxX402Broker(fetchImpl, ENV, {
      now: () => new Date(NOW),
      correlationId: () => "corr_verify",
      diagnosticSink: () => undefined,
    });
    await broker.verify(payment(), requirements());
    assert.equal(capturedUrl, "https://web3.okx.com/api/v6/pay/x402/verify");
    assert.equal(capturedInit?.method, "POST");
    const body = String(capturedInit?.body);
    const expected = createHmac("sha256", SECRET)
      .update(`${NOW}POST/api/v6/pay/x402/verify${body}`)
      .digest("base64");
    assert.equal(new Headers(capturedInit?.headers).get("OK-ACCESS-SIGN"), expected);
    assert.equal(new Headers(capturedInit?.headers).get("OK-ACCESS-TIMESTAMP"), NOW);
    assert.deepEqual(JSON.parse(body), {
      x402Version: 2,
      paymentPayload: payment(),
      paymentRequirements: requirements(),
    });
  });

  await test("verify accepts object and single-entry array data envelopes", async () => {
    for (const data of [
      { isValid: true, payer: BUYER },
      [{ isValid: true, payer: BUYER }],
    ]) {
      const broker = new OkxX402Broker(
        (async () => new Response(JSON.stringify({ code: "0", msg: "", data }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
        ENV,
        { diagnosticSink: () => undefined }
      );
      assert.equal((await broker.verify(payment(), requirements())).isValid, true);
    }
  });

  await test("numeric code zero is normalized without weakening verification", async () => {
    const broker = new OkxX402Broker(
      (async () => new Response(JSON.stringify({ code: 0, msg: "", data: [{ isValid: true, payer: BUYER }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
      ENV,
      { diagnosticSink: () => undefined }
    );
    assert.equal((await broker.verify(payment(), requirements())).isValid, true);
  });

  await test("absent data or isValid is an unrecognized response, not a rejection", async () => {
    for (const body of [
      { code: "0", msg: "" },
      { code: "0", msg: "", data: {} },
      { code: "0", msg: "", data: [] },
    ]) {
      const broker = new OkxX402Broker(
        (async () => new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
        ENV,
        { diagnosticSink: () => undefined }
      );
      await expectCode(
        () => broker.verify(payment(), requirements()),
        "FACILITATOR_RESPONSE_SHAPE_UNRECOGNIZED"
      );
    }
  });

  await test("safe rejection details are preserved from the envelope level", async () => {
    const diagnostics: FacilitatorDiagnostic[] = [];
    const broker = new OkxX402Broker(
      (async () => new Response(JSON.stringify({
        code: "0",
        msg: "",
        data: [{ isValid: false, payer: BUYER }],
        invalidReason: "invalid_signature",
        invalidMessage: "Authorization rejected",
      }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch,
      ENV,
      { diagnosticSink: (entry) => diagnostics.push(entry) }
    );
    await expectCode(() => broker.verify(payment(), requirements()), "PAYMENT_SIGNATURE_INVALID");
    assert.equal(diagnostics[0]?.invalidReason, "invalid_signature");
    assert.equal(diagnostics[0]?.invalidMessage, "Authorization rejected");
    assert.equal(diagnostics[0]?.responseShape?.dataType, "array");
    assert.equal(diagnostics[0]?.responseShape?.isValidPresent, true);
  });

  await test("settle uses the current route", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({
        code: "0",
        msg: "",
        data: { success: true, status: "success", payer: BUYER, transaction: `0x${"cd".repeat(32)}`, network: "eip155:196" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const broker = new OkxX402Broker(fetchImpl, ENV, { diagnosticSink: () => undefined });
    await broker.settle(payment(), requirements());
    assert.equal(capturedUrl, "https://web3.okx.com/api/v6/pay/x402/settle");
    await broker.settlementStatus(`0x${"cd".repeat(32)}`);
    assert.equal(
      capturedUrl,
      `https://web3.okx.com/api/v6/pay/x402/settle/status?txHash=0x${"cd".repeat(32)}`
    );
  });

  await test("nonzero broker auth response becomes a safe correlated auth error", async () => {
    const diagnostics: FacilitatorDiagnostic[] = [];
    const fetchImpl = (async () => new Response(JSON.stringify({
      code: "50111",
      msg: "Invalid OK-ACCESS-KEY api-key-value and passphrase-value",
    }), { status: 401, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const broker = new OkxX402Broker(fetchImpl, ENV, {
      now: () => new Date(NOW),
      correlationId: () => "corr_auth",
      diagnosticSink: (entry) => diagnostics.push(entry),
    });
    await assert.rejects(
      () => broker.verify(payment(), requirements()),
      (error: unknown) => error instanceof A2mcpX402Error &&
        error.code === "FACILITATOR_AUTH_ERROR" &&
        error.correlationId === "corr_auth" &&
        !error.message.includes("api-key-value")
    );
    const serialized = JSON.stringify(diagnostics);
    assert.equal(diagnostics[0]?.httpStatus, 401);
    assert.equal(diagnostics[0]?.okxCode, "50111");
    assert.ok(!serialized.includes("api-key-value"));
    assert.ok(!serialized.includes("passphrase-value"));
    assert.ok(!serialized.includes(SECRET));
    assert.ok(!serialized.includes(payment().payload.signature));
  });

  await test("code=0 isValid=false preserves safe reason in logs but not the client error", async () => {
    const diagnostics: FacilitatorDiagnostic[] = [];
    const fetchImpl = (async () => new Response(JSON.stringify({
      code: "0",
      msg: "",
      data: {
        isValid: false,
        invalidReason: "invalid_signature",
        invalidMessage: `signature ${payment().payload.signature} secret ${SECRET}`,
        payer: BUYER,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const broker = new OkxX402Broker(fetchImpl, ENV, {
      correlationId: () => "corr_invalid",
      diagnosticSink: (entry) => diagnostics.push(entry),
    });
    await assert.rejects(
      () => broker.verify(payment(), requirements()),
      (error: unknown) => error instanceof A2mcpX402Error &&
        error.code === "PAYMENT_SIGNATURE_INVALID" &&
        error.message.includes("corr_invalid") &&
        !error.message.includes("invalid_signature")
    );
    const serialized = JSON.stringify(diagnostics);
    assert.equal(diagnostics[0]?.isValid, false);
    assert.equal(diagnostics[0]?.invalidReason, "invalid_signature");
    assert.equal(diagnostics[0]?.payer, "0x111111...111111");
    assert.ok(!serialized.includes(payment().payload.signature));
    assert.ok(!serialized.includes(SECRET));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
