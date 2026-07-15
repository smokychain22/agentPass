import assert from "node:assert/strict";

function diagnosticAllowedForEnv(
  env: Record<string, string | undefined>,
  request: Request
): boolean {
  const isProduction = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  const secret = env.REPODIET_INTERNAL_DIAGNOSTIC_SECRET?.trim();

  if (isProduction) {
    if (!secret) return false;
    return request.headers.get("x-repodiet-diagnostic-secret") === secret;
  }

  const allowFlag = env.REPODIET_ALLOW_INTERNAL_DIAGNOSTIC === "1";
  const nonProd = env.NODE_ENV !== "production";
  if (!allowFlag && !nonProd) return false;
  if (!secret) return allowFlag || nonProd;
  return request.headers.get("x-repodiet-diagnostic-secret") === secret;
}

async function run() {
  console.log("A2MCP diagnostic route security");

  const prodNoSecret = diagnosticAllowedForEnv(
    { VERCEL_ENV: "production", NODE_ENV: "production" },
    new Request("http://localhost", { headers: {} })
  );
  assert.equal(prodNoSecret, false, "production without secret must be blocked");

  const prodWrongSecret = diagnosticAllowedForEnv(
    {
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      REPODIET_INTERNAL_DIAGNOSTIC_SECRET: "expected",
    },
    new Request("http://localhost", { headers: { "x-repodiet-diagnostic-secret": "wrong" } })
  );
  assert.equal(prodWrongSecret, false, "production wrong secret must be blocked");

  const prodOk = diagnosticAllowedForEnv(
    {
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      REPODIET_INTERNAL_DIAGNOSTIC_SECRET: "expected",
    },
    new Request("http://localhost", { headers: { "x-repodiet-diagnostic-secret": "expected" } })
  );
  assert.equal(prodOk, true, "production matching secret must be allowed");

  const prodFlagOnly = diagnosticAllowedForEnv(
    {
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      REPODIET_ALLOW_INTERNAL_DIAGNOSTIC: "1",
    },
    new Request("http://localhost", { headers: {} })
  );
  assert.equal(prodFlagOnly, false, "production allow flag alone must not open diagnostic");

  console.log("A2MCP diagnostic route security: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
