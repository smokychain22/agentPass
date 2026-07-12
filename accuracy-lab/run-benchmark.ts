import fs from "node:fs/promises";
import path from "node:path";

interface AccuracyCase {
  id: string;
  category: string;
  groundTruth: {
    expectedFinding: boolean;
    autofixAllowed: boolean;
    remediationClass?: string;
  };
}

async function main() {
  const casesDir = path.join(import.meta.dirname, "cases");
  const files = (await fs.readdir(casesDir)).filter((f) => f.endsWith(".json"));
  let valid = 0;
  for (const file of files) {
    const raw = await fs.readFile(path.join(casesDir, file), "utf8");
    const c = JSON.parse(raw) as AccuracyCase;
    if (!c.id || !c.category || !c.groundTruth) {
      throw new Error(`Invalid case: ${file}`);
    }
    valid += 1;
    console.log(`  ✓ ${c.id} (${c.category})`);
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(import.meta.dirname, "manifest.json"), "utf8")
  );
  console.log(`accuracy-lab: ${valid} case(s) validated`);
  console.log(`release targets: precision ≥ ${manifest.releaseTargets.displayedFindingsPrecision * 100}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
