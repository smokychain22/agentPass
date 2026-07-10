#!/usr/bin/env node
import { runFindingsEngine } from "../src/lib/findings/findings-engine.ts";
import { runFreeCleanupCore } from "../src/lib/execution/run-cleanup-core.ts";

const repo = process.env.TEST_REPO || "https://github.com/Ibrahimmovic/Circle-Arc-Net";

async function main() {
  console.log("Scanning", repo);
  const findings = await runFindingsEngine(repo, "main");
  console.log("scanId", findings.scanId, "commit", findings.repo.commitSha);
  console.log("analyzers", JSON.stringify(findings.rawToolReports, null, 2));

  const safe = [...findings.unused.exports].filter((f) => f.action === "safe_candidate");
  console.log(
    "safe candidates",
    safe.length,
    safe.map((f) => f.title).slice(0, 15)
  );

  const clock = safe.find((f) => f.title.includes("Clock"));
  if (clock) {
    console.log("\n=== Clock finding ===");
    console.log(JSON.stringify(clock, null, 2));
  }

  console.log("\n=== Running free cleanup ===");
  const result = await runFreeCleanupCore(findings);
  console.log("finalDecision", result.proof.finalDecision);
  console.log("verifiedLabel", result.verifiedLabel);

  for (const a of result.fixLoop.attempts) {
    console.log("\n--- ATTEMPT ---");
    console.log("title:", a.title);
    console.log("status:", a.status);
    console.log("reason:", a.reason);
    console.log("plugin:", a.pluginId);
    if (a.comparison?.length) {
      console.log("comparison:", a.comparison);
    }
    if (a.baselineReport) {
      console.log("baseline summary:", result.verification.baselineSummary);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
