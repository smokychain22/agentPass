import assert from "node:assert/strict";
import { POST as intakePost } from "../src/app/api/okx/a2a/intake/route";
import { GET as servicesGet } from "../src/app/api/okx/services/route";

async function run() {
  console.log("okx-service-binding-route");
  const servicesResponse = await servicesGet();
  const services = (await servicesResponse.json()) as {
    services: Array<{ serviceType: string; operation: string }>;
  };
  assert.deepEqual(
    services.services.map((service) => [service.serviceType, service.operation]),
    [
      ["A2MCP", "analyze_repository"],
      ["A2A", "create_cleanup_pr"],
    ]
  );

  const accepted = await intakePost(
    new Request("https://skillswap-virid-kappa.vercel.app/api/okx/a2a/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I would like to use the services of agent ID 5283",
        agentId: "5283",
        serviceId: "32947",
        serviceType: "A2A",
      }),
    })
  );
  assert.equal(accepted.status, 200);
  const body = (await accepted.json()) as {
    taskPolicy: Record<string, boolean>;
    permittedActions: string[];
    scanStarted: boolean;
    paymentRequired: boolean;
  };
  assert.equal(body.taskPolicy.availabilityOnly, true);
  assert.equal(body.taskPolicy.fundEscrow, false);
  assert.equal(body.taskPolicy.repositoryScan, false);
  assert.deepEqual(body.permittedActions, ["record_provider_response"]);
  assert.equal(body.scanStarted, false);
  assert.equal(body.paymentRequired, false);

  const wrongProtocol = await intakePost(
    new Request("https://skillswap-virid-kappa.vercel.app/api/okx/a2a/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I would like to use the services of agent ID 5283",
        agentId: "5283",
        serviceId: "32948",
        serviceType: "A2MCP",
      }),
    })
  );
  assert.equal(wrongProtocol.status, 422);
  const wrongBody = (await wrongProtocol.json()) as { code: string; paymentRequired: boolean };
  assert.equal(wrongBody.code, "INCOMPATIBLE_SERVICE_BINDING");
  assert.equal(wrongBody.paymentRequired, false);
  console.log("okx-service-binding-route: all passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
