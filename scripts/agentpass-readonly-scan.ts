#!/usr/bin/env tsx
/**
 * Second real-repository evidence: dogfood agentPass (not a fixture).
 * Development audit only — not production worker proof.
 */
import { runBasicScan } from "../src/lib/scanner/run-scan";
import { AGENTPASS_DOGFOOD } from "../src/lib/product/proof-repositories";
import { buildTenantBinding } from "../src/lib/tenant/types";
import { isPrivilegedRepository } from "../src/lib/product/bypass-audit";
import fs from "node:fs";

async function main() {
  const started = Date.now();
  assertNotPrivileged();
  const scan = await runBasicScan(AGENTPASS_DOGFOOD.url, "main");
  const tenant = buildTenantBinding({
    buyerWallet: "0xnewcustomer000000000000000000000000000001",
    repositoryOwner: scan.repo.owner,
    repositoryName: scan.repo.name,
    branch: scan.repo.branch,
    sourceCommit: scan.repo.commitSha,
    projectRoot: scan.repositoryModel?.primaryProjectRoot || ".",
  });
  const out = {
    executionLabel: "DEVELOPMENT AUDIT ONLY",
    repository: AGENTPASS_DOGFOOD.url,
    role: "validation_target_dogfood",
    privilegedByName: isPrivilegedRepository(scan.repo.owner, scan.repo.name),
    tenantId: tenant.tenantId,
    sourceCommit: scan.repo.commitSha,
    coverage: scan.scanCoverage?.contract,
    inventory: scan.intelligenceManifest?.inventory,
    durationMs: Date.now() - started,
  };
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync("/opt/cursor/artifacts/agentpass-readonly-scan.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

function assertNotPrivileged() {
  if (isPrivilegedRepository("smokychain22", "agentPass")) {
    throw new Error("agentPass must not be privileged");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
