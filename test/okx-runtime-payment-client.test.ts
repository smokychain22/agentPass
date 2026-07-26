import assert from "node:assert/strict";
import {
  decodePaymentRequired,
  executeCanonicalPaidReplay,
  InMemoryPaymentExecutionStore,
  FilePaymentExecutionStore,
  parseCanonicalBusinessRequest,
  selectProductionTerms,
  type A2mcpPaymentTransport,
  type X402Challenge,
} from "../src/lib/okx-runtime/a2mcp-payment-client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage";
const BODY = JSON.stringify({
  repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
  branch: "main",
  maximumFindings: 10,
  options: { include: ["src/**"], exclude: ["node_modules/**"] },
});
const CHALLENGE: X402Challenge = {
  x402Version: 2,
  resource: { url: URL, mimeType: "application/json" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:196",
      asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      amount: "30000",
      payTo: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    },
  ],
};

async function run() {
  console.log("okx-runtime-payment-client");
  const request = parseCanonicalBusinessRequest({ url: URL, bodyText: BODY });
  assert.equal(request.contentType, "application/json");
  assert.deepEqual(request.body.options, {
    include: ["src/**"],
    exclude: ["node_modules/**"],
  });
  assert.equal(JSON.parse(request.bodyText).repositoryUrl, request.body.repositoryUrl);
  assert.throws(
    () => parseCanonicalBusinessRequest({ url: URL, bodyText: JSON.stringify(BODY) }),
    /double_encoded_json_request/
  );
  assert.throws(
    () => parseCanonicalBusinessRequest({ url: URL, bodyText: "[object Object]" }),
    /invalid_json_request/
  );

  const encoded = Buffer.from(JSON.stringify(CHALLENGE)).toString("base64");
  assert.deepEqual(decodePaymentRequired(encoded), CHALLENGE);
  assert.equal(selectProductionTerms(CHALLENGE, request).amount, "30000");
  assert.throws(
    () =>
      selectProductionTerms(
        {
          ...CHALLENGE,
          accepts: [{ ...CHALLENGE.accepts[0], amount: "1000000" }],
        },
        request
      ),
    /canonical_payment_terms_missing/
  );

  let quotes = 0;
  let authorizations = 0;
  let replays = 0;
  let replayedBody = "";
  const transport: A2mcpPaymentTransport = {
    async quote(received) {
      quotes += 1;
      assert.deepEqual(JSON.parse(received.bodyText), received.body);
      return CHALLENGE;
    },
    async authorize({ request: received }) {
      authorizations += 1;
      assert.match(received.bodyDigest, /^sha256:[a-f0-9]{64}$/);
      return {
        headerName: "PAYMENT-SIGNATURE",
        authorizationHeader: "[secret header omitted]",
      };
    },
    async replay({ request: received }) {
      replays += 1;
      replayedBody = received.bodyText;
      return {
        status: 200,
        body: { findings: [{ id: "finding-1" }] },
        paymentResponse: "mock-receipt",
        transactionReference: `0x${"12".repeat(32)}`,
      };
    },
  };
  const store = new InMemoryPaymentExecutionStore();
  const first = await executeCanonicalPaidReplay({ request, transport, store });
  assert.equal(first.idempotentReplay, false);
  assert.equal(replayedBody, request.bodyText);
  const second = await executeCanonicalPaidReplay({ request, transport, store });
  assert.equal(second.idempotentReplay, true);
  assert.equal(replays, 1);
  assert.equal(authorizations, 1);
  assert.equal(quotes, 2);

  const changed = parseCanonicalBusinessRequest({
    url: URL,
    bodyText: BODY.replace('"main"', '"other"'),
  });
  await executeCanonicalPaidReplay({ request: changed, transport, store });
  assert.equal(replays, 2);

  const malformedTransport: A2mcpPaymentTransport = {
    ...transport,
    async replay() {
      throw new Error("replay must not occur for malformed input");
    },
  };
  await assert.rejects(
    async () =>
      executeCanonicalPaidReplay({
        request,
        transport: {
          ...malformedTransport,
          async quote() {
            return { ...CHALLENGE, resource: { url: `${URL}/wrong` } };
          },
        },
        store: new InMemoryPaymentExecutionStore(),
      }),
    /payment_resource_mismatch/
  );

  await assert.rejects(
    async () =>
      executeCanonicalPaidReplay({
        request,
        transport: {
          ...transport,
          async replay() {
            return { status: 200, body: { findings: [] } };
          },
        },
        store: new InMemoryPaymentExecutionStore(),
      }),
    /settlement_receipt_missing/
  );

  const fileStore = new FilePaymentExecutionStore(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-payment-")), "executions.json")
  );
  const reservations = await Promise.all([
    fileStore.reserve("sha256:concurrent"),
    fileStore.reserve("sha256:concurrent"),
  ]);
  assert.equal(reservations.filter((entry) => entry.created).length, 1);
  console.log("okx-runtime-payment-client: all passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
