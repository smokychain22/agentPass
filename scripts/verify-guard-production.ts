#!/usr/bin/env tsx
/**
 * Phase 6 Repo Guard verification.
 * Usage: REPODIET_PRODUCTION_URL=... npm run verify:guard
 */
const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const REPO = process.env.REPODIET_GUARD_TEST_REPO || "repodiet/demo-slop-app";
const BRANCH = "main";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  if (!BASE) {
    console.error("FAIL: Set REPODIET_PRODUCTION_URL");
    process.exit(1);
  }

  process.env.REPODIET_GUARD_TEST_MODE = "1";
  console.log(`Repo Guard verify: ${BASE}`);

  const activateRes = await fetch(`${BASE}/api/guard/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "activate",
      repoUrl: `https://github.com/${REPO}`,
      branch: BRANCH,
      protectedPaths: ["src/auth/**", "migrations/**"],
    }),
  });
  const activateJson = await activateRes.json();
  record("guard activation", activateRes.ok && activateJson.success, activateJson.subscription?.status);
  const subscriptionId = activateJson.subscription?.id as string | undefined;
  const baselineScanId = activateJson.baselineRun?.currentScanId as string | undefined;

  const statusRes = await fetch(`${BASE}/api/guard/${encodeURIComponent(REPO)}`);
  const statusJson = await statusRes.json();
  record("guard status endpoint", statusRes.ok && statusJson.active === true);
  record("repository policy stored", Boolean(statusJson.policy?.protectedPaths?.length));

  const mergeSha = `merge_${Date.now().toString(16)}abc123`;
  const webhookRes = await fetch(`${BASE}/api/github/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "pull_request",
      "X-RepoDiet-Guard-Test": "1",
    },
    body: JSON.stringify({
      action: "closed",
      repository: {
        full_name: REPO,
        name: REPO.split("/")[1],
        owner: { login: REPO.split("/")[0] },
        default_branch: BRANCH,
      },
      pull_request: {
        merged: true,
        merge_commit_sha: mergeSha,
      },
    }),
  });
  const webhookJson = await webhookRes.json();
  record("webhook received", webhookRes.ok && webhookJson.handled === true);
  record("commit SHA captured", webhookJson.run?.commitSha === mergeSha, webhookJson.run?.commitSha);
  record("delta scan ran", Boolean(webhookJson.run?.delta));
  record(
    "only new findings presented",
    webhookJson.run?.delta?.presentedCount === webhookJson.run?.delta?.newCount,
    `new=${webhookJson.run?.delta?.newCount}`
  );
  record("policy applied proposal", Boolean(webhookJson.run?.proposal));
  record(
    "meaningful notification",
    Boolean(webhookJson.run?.notification?.meaningful),
    webhookJson.run?.notification?.title
  );

  if (baselineScanId && webhookJson.run?.id) {
    const rejectRes = await fetch(`${BASE}/api/guard/${encodeURIComponent(REPO)}`);
    const rejectJson = await rejectRes.json();
    record("subscription persists", rejectJson.subscription?.id === subscriptionId);
  }

  const trivialPush = await fetch(`${BASE}/api/github/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "push",
      "X-RepoDiet-Guard-Test": "1",
    },
    body: JSON.stringify({
      ref: `refs/heads/${BRANCH}`,
      after: `push_${Date.now()}`,
      repository: {
        full_name: REPO,
        name: REPO.split("/")[1],
        owner: { login: REPO.split("/")[0] },
        default_branch: BRANCH,
      },
      commits: [{ modified: ["README.md"], added: [], removed: [] }],
    }),
  });
  const trivialJson = await trivialPush.json();
  record(
    "minor commit scan skipped",
    trivialJson.handled && !trivialJson.run,
    trivialJson.reason
  );

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
    console.log("OVERALL: FAIL");
    process.exit(1);
  }
  console.log("OVERALL: PASS");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
