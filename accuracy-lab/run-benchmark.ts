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
  const labDir = import.meta.dirname;
  const casesDir = path.join(labDir, "cases");
  const files = (await fs.readdir(casesDir)).filter((f) => f.endsWith(".json"));

  const manifest = JSON.parse(
    await fs.readFile(path.join(labDir, "manifest.json"), "utf8")
  ) as {
    caseCategories: string[];
    releaseTargets: { displayedFindingsPrecision: number };
  };

  const cases: AccuracyCase[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(casesDir, file), "utf8");
    const c = JSON.parse(raw) as AccuracyCase;
    if (!c.id || !c.category || !c.groundTruth) {
      throw new Error(`Invalid case: ${file}`);
    }
    cases.push(c);
    console.log(`  ✓ ${c.id} (${c.category})`);
  }

  const covered = new Set(cases.map((c) => c.category));
  const missing = manifest.caseCategories.filter((cat) => !covered.has(cat));
  const extra = [...covered].filter((cat) => !manifest.caseCategories.includes(cat));

  if (missing.length) {
    throw new Error(`Missing benchmark categories: ${missing.join(", ")}`);
  }
  if (extra.length) {
    throw new Error(`Unknown categories in cases: ${extra.join(", ")}`);
  }

  console.log(`accuracy-lab: ${cases.length} case(s) validated`);
  console.log(`categories covered: ${manifest.caseCategories.length}/${manifest.caseCategories.length}`);
  console.log(`release targets: precision ≥ ${manifest.releaseTargets.displayedFindingsPrecision * 100}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
