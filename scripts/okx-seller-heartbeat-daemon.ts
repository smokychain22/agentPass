#!/usr/bin/env tsx
/**
 * Sends the authenticated seller-runtime heartbeat on an interval, gated on a
 * live `onchainos agent gate-check --role asp` pass for Agent 9636. Never
 * claims online without a fresh passing gate-check in the same tick.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.REPODIET_PRODUCTION_URL || "https://skillswap-virid-kappa.vercel.app";
const SECRET = process.env.REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET;
const ASP_AGENT_ID = "9636";
const A2A_SERVICE_ID = "37348";
const SELLER_WALLET = "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";
const COMMUNICATION_ADDRESS = "0x00dbdbb36b71ace0e1fc517056f376f977d8256e";
const INTERVAL_MS = 60_000;
const TTL_SECONDS = 90;

if (!SECRET || SECRET.length < 32) {
  console.error("REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET missing or too short in this shell");
  process.exit(1);
}

async function gateCheckPasses(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("onchainos", ["agent", "gate-check", "--role", "asp"]);
    const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
    return (
      parsed?.data?.ready === true &&
      parsed?.data?.identity?.agentId === ASP_AGENT_ID &&
      parsed?.data?.communication?.ok === true &&
      parsed?.data?.wallet?.ok === true
    );
  } catch {
    return false;
  }
}

async function xmtpClientActive(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("okx-a2a", ["agent", "refresh", "--json"]);
    const parsed = JSON.parse(stdout.trim());
    return parsed?.ok === true && (parsed?.payload?.activeClients ?? 0) >= 1;
  } catch {
    return false;
  }
}

async function sendHeartbeat(): Promise<void> {
  const gateOk = await gateCheckPasses();
  const xmtpOk = await xmtpClientActive();
  if (!gateOk || !xmtpOk) {
    console.log(
      JSON.stringify({ at: new Date().toISOString(), sent: false, gateOk, xmtpOk })
    );
    return;
  }

  const response = await fetch(`${BASE_URL}/api/internal/okx/seller-heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify({
      aspAgentId: ASP_AGENT_ID,
      a2aServiceId: A2A_SERVICE_ID,
      sellerWallet: SELLER_WALLET,
      registeredCommunicationAddress: COMMUNICATION_ADDRESS,
      recoveredSignerAddress: COMMUNICATION_ADDRESS,
      onchainOsAuthenticated: true,
      officialWatchActive: true,
      xmtpClientReady: true,
      ttlSeconds: TTL_SECONDS,
    }),
  });
  const body = await response.json();
  console.log(
    JSON.stringify({ at: new Date().toISOString(), sent: true, status: response.status, body })
  );
}

async function main() {
  console.log(`okx-seller-heartbeat-daemon: starting, base=${BASE_URL}, interval=${INTERVAL_MS}ms`);
  await sendHeartbeat();
  setInterval(() => {
    sendHeartbeat().catch((error) => console.error("heartbeat_error", error));
  }, INTERVAL_MS);
}

main();
