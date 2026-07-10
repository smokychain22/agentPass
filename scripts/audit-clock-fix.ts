#!/usr/bin/env tsx
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { runFreeCleanupCore } from "@/lib/execution/run-cleanup-core";

const repo = process.env.TEST_REPO || "https://github.com/Ibrahimmovic/Circle-Arc-Net";

async function main() {
  console.log("Scanning", repo);
  const findings = await runFindingsEngine(repo, "main");
  console.log("scanId", findings.scanId, "commit", findings.repo.commitSha);
  console.log("analyzers", JSON.stringify(findings.rawToolReports, null, 2));

  const safe = [...findings.unused.exports].filter((f) => f.action === "safe_candidate");
  console.log("safe candidates", safe.length, safe.map((f) => f.title).slice(0, 15));

  const clock = safe.find((f) => f.title.includes("Clock"));
  if (clock) console.log("\nClock finding\n", JSON.stringify(clock, null, 2));

  const result = await runFreeCleanupCore(findings);
  console.log("\nfinalDecision", result.proof.finalDecision);
  console.log("verifiedLabel", result.verifiedLabel);
  for (const a of result.fixLoop.attempts) {
    console.log("\nATTEMPT", a.title, "|", a.status, "|", a.reason);
    if (a.comparison?.length) console.log("comparison", a.comparison);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
