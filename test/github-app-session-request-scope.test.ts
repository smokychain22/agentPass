/**
 * Evidence for the failure that stopped a real, escrow-funded delivery.
 *
 * `resolveCleanupGitHubToken` treats a null installation session as the
 * documented seller-delivery path: no browser Patch-tab cookie exists in a
 * background process, so it falls back to `resolveAspGitHubToken` for a
 * repository where the GitHub App is already installed.
 *
 * That fallback was unreachable. `readInstallationSession` called `cookies()`,
 * which does not return null outside a request scope — it THROWS. Traced live
 * on the headless seller runtime: every `job_accepted` turn for the accepted,
 * escrow-funded job 0x22a2… failed with "`cookies` was called outside a
 * request scope", the event retried to its 15-attempt ceiling and went
 * terminal, and the deliverable was never produced.
 */
import assert from "node:assert/strict";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/**
 * The App must look configured, or `readInstallationSession` short-circuits to
 * null before it ever reaches the cookie jar and the test proves nothing.
 */
function configureGitHubApp(): void {
  process.env.GITHUB_APP_ID = "test-app-id";
  process.env.GITHUB_APP_CLIENT_ID = "test-client-id";
  process.env.GITHUB_APP_CLIENT_SECRET = "test-client-secret";
  process.env.GITHUB_APP_PRIVATE_KEY = "test-private-key";
  process.env.GITHUB_APP_SLUG = "repodiet-operator";
}

async function run() {
  console.log("github-app session outside a request scope");

  configureGitHubApp();
  const { isGitHubAppConfigured } = await import("../src/lib/github-app/config");
  assert.equal(
    isGitHubAppConfigured(),
    true,
    "test setup: the App must be configured or the null short-circuit hides the real path"
  );

  const { readInstallationSession } = await import("../src/lib/github-app/session");

  await test("cookies() genuinely throws outside a request scope", async () => {
    // Pins the precondition this fix exists for. If a future Next.js makes
    // `cookies()` return an empty jar instead, this test fails loudly and the
    // catch below can be reconsidered rather than silently kept forever.
    const { cookies } = await import("next/headers");
    await assert.rejects(async () => {
      await cookies();
    });
  });

  await test("readInstallationSession returns null instead of throwing", async () => {
    // This is the whole fix: a background caller must get the null its
    // contract already defines, not an exception.
    const session = await readInstallationSession();
    assert.equal(session, null);
  });

  await test("it is null, not a thrown error, on repeated calls", async () => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(await readInstallationSession(), null);
    }
  });

  await test("an unconfigured App still returns null", async () => {
    const saved = process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_ID;
    try {
      assert.equal(await readInstallationSession(), null);
    } finally {
      process.env.GITHUB_APP_ID = saved;
    }
  });

  console.log("github-app session outside a request scope: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
