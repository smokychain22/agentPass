#!/usr/bin/env tsx
import { runFindingsEngine } from "../src/lib/findings/findings-engine";

async function main() {
  const repo = process.argv[2] || "https://github.com/Ibrahimmovic/Circle-Arc-Net";
  const branch = process.argv[3] || "main";
  const f = await runFindingsEngine(repo, branch);
  console.log(JSON.stringify({ summary: f.summary, analyzers: f.rawToolReports }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
