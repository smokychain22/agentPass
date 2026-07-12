import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cloneExactCommit, generateGitPatch, validateGitPatch } from "../src/lib/execution/git-clone";

async function testShallowClonePatchApplyWithIndex(): Promise<void> {
  const workRoot = path.join("/tmp", `repodiet-git-index-${Date.now()}`);
  const baseCommitSha = "7c5df00e977a848459cf5407008ecce9c6a5b4b8";
  const repoUrl = "https://github.com/velz-cmd/repodiet-e2e-test";

  const { rootDir: baselineRoot } = await cloneExactCommit({
    repoUrl,
    baseCommitSha,
    workDir: workRoot,
  });

  const dashboardPath = path.join(baselineRoot, "src/components/Dashboard.tsx");
  const original = await fs.readFile(dashboardPath, "utf8");
  const edited = original.replace(
    'import { CheckCircle, Clock } from "lucide-react";',
    'import { CheckCircle } from "lucide-react";'
  );
  assert.notEqual(original, edited);

  const transformedRoot = path.join(workRoot, "transformed");
  await fs.cp(baselineRoot, transformedRoot, { recursive: true, force: true });
  const { patch } = await generateGitPatch(transformedRoot, [
    { path: "src/components/Dashboard.tsx", content: edited },
  ]);

  const result = await validateGitPatch(baselineRoot, patch, ["src/components/Dashboard.tsx"]);
  assert.equal(result.status, "passed", result.stderr);
}

testShallowClonePatchApplyWithIndex()
  .then(() => console.log("git-index-apply.test.ts: ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
