import assert from "node:assert/strict";
import { POST } from "../src/app/api/a2mcp/quick-triage/route";

function test(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

async function run() {
  console.log("quick-triage-route");

  await test("rejects invalid repository URL", async () => {
    const req = new Request("http://localhost/api/a2mcp/quick-triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryUrl: "https://gitlab.com/example/repo",
        branch: "main",
        maximumFindings: 5,
      }),
    });
    const res = await POST(req);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(res.status, 422);
    assert.equal(json.error?.code, "UNSUPPORTED_REPOSITORY");
  });

  await test("rejects invalid maximumFindings", async () => {
    const req = new Request("http://localhost/api/a2mcp/quick-triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryUrl: "https://github.com/vercel/next.js",
        branch: "main",
        maximumFindings: 99,
      }),
    });
    const res = await POST(req);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(res.status, 400);
    assert.equal(json.error?.code, "INVALID_INPUT");
  });

  console.log("quick-triage-route: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

