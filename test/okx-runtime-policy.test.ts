import assert from "node:assert/strict";
import {
  assertExactPaymentApproval,
  parseBuyerTaskPolicy,
  taskPolicyAllows,
  type PaymentApproval,
} from "../src/lib/okx-runtime/task-policy";
import { requirePinnedService } from "../src/lib/okx-runtime/service-selection";

function run() {
  console.log("okx-runtime-policy");
  const availability = parseBuyerTaskPolicy({
    availabilityOnly: true,
    startWork: true,
    fundEscrow: true,
    repositoryScan: true,
    createBranch: true,
    createPullRequest: true,
    paymentAuthorised: true,
  });
  assert.equal(taskPolicyAllows(availability, "record_provider_response"), true);
  for (const action of [
    "select_payment_mode",
    "accept_quote",
    "fund_escrow",
    "start_work",
    "scan_repository",
    "create_branch",
    "create_pull_request",
  ] as const) {
    assert.equal(taskPolicyAllows(availability, action), false, action);
  }

  const explanation = parseBuyerTaskPolicy({
    availabilityOnly: true,
    startWork: false,
    fundEscrow: false,
    repositoryScan: false,
    createBranch: false,
    createPullRequest: false,
    paymentAuthorised: false,
  });
  assert.equal(taskPolicyAllows(explanation, "accept_quote"), false);

  const expected = {
    jobId: "job-a",
    serviceId: "37348",
    operation: "create_cleanup_pr",
    network: "eip155:196",
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    amountAtomic: "200000",
    recipient: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    idempotencyKey: "approve-job-a-200000",
  };
  const approval: PaymentApproval = { ...expected, approvedAt: new Date().toISOString() };
  assert.doesNotThrow(() => assertExactPaymentApproval(approval, expected));
  assert.throws(
    () => assertExactPaymentApproval(approval, { ...expected, jobId: "job-b" }),
    /payment_approval_mismatch/
  );
  assert.throws(
    () => assertExactPaymentApproval(approval, { ...expected, amountAtomic: "1000000" }),
    /payment_approval_mismatch/
  );
  assert.throws(
    () => assertExactPaymentApproval(approval, { ...expected, serviceId: "37347" }),
    /payment_approval_mismatch/
  );

  assert.equal(
    requirePinnedService({
      protocol: "a2a",
      agentId: "9636",
      serviceId: "37348",
      serviceType: "A2A",
    }).operation,
    "create_cleanup_pr"
  );
  assert.equal(
    requirePinnedService({
      protocol: "a2mcp",
      agentId: "9636",
      serviceId: "37347",
      serviceType: "A2MCP",
    }).operation,
    "analyze_repository"
  );
  assert.throws(
    () =>
      requirePinnedService({
        protocol: "a2a",
        agentId: "9636",
        serviceType: "A2A",
      }),
    /service_id_required/
  );
  assert.throws(
    () =>
      requirePinnedService({
        protocol: "a2a",
        agentId: "9636",
        serviceId: "37347",
        serviceType: "A2MCP",
      }),
    /service_id_mismatch/
  );
  console.log("okx-runtime-policy: all passed");
}

run();
