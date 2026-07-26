#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { parseCanonicalBusinessRequest } from "../src/lib/okx-runtime/a2mcp-payment-client";
import { runProcess } from "../src/lib/okx-runtime/process-runner";

const URL = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parameterArgs(body: Record<string, unknown>): string[] {
  return Object.entries(body).flatMap(([key, value]) => {
    if (value !== null && typeof value === "object") {
      return ["--param", `${key}=${JSON.stringify(value)}`];
    }
    return ["--param", `${key}=${String(value)}`];
  });
}

async function main() {
  const stage = option("--stage") ?? "quote";
  const requestFile = path.resolve(option("--request") ?? ".repodiet-canary-request.json");
  const executable = option("--onchainos") ?? "onchainos";
  if (!["quote", "pay"].includes(stage)) throw new Error("stage_must_be_quote_or_pay");

  if (!fs.existsSync(requestFile)) {
    throw new Error(
      "request_file_required: create one canonical JSON file and use the same file for quote and pay"
    );
  }
  const bodyText = fs.readFileSync(requestFile, "utf8");
  const request = parseCanonicalBusinessRequest({ url: URL, bodyText });
  const args = parameterArgs(request.body);

  if (stage === "quote") {
    const result = await runProcess(
      executable,
      ["payment", "quote", URL, "--method", "POST", ...args],
      { timeoutMs: 30_000 }
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (!process.argv.includes("--confirm-payment")) {
    throw new Error("payment_confirmation_required");
  }
  const paymentId = option("--payment-id");
  if (!paymentId) throw new Error("payment_id_required");
  const result = await runProcess(
    executable,
    [
      "payment",
      "pay",
      "--payment-id",
      paymentId,
      "--selected-index",
      option("--selected-index") ?? "0",
      "--yes",
      ...args,
    ],
    { timeoutMs: 120_000 }
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
