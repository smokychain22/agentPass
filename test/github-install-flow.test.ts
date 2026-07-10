import assert from "node:assert/strict";
import {
  createInstallFlowRecord,
  hashInstallState,
  isInstallFlowExpired,
} from "../src/lib/github-app/install-flow-store";
import {
  consumeInstallFlowState,
  generateInstallStateToken,
  resolveInstallFlowState,
  createInstallFlow,
} from "../src/lib/github-app/install-flow";
import { parseInstallCallbackParams } from "../src/lib/github-app/install-callback";
import { accessCopyForState } from "../src/lib/github-app/access-states";
import { parseRepositoryFullName, requiresRepositoryOwnerInstall } from "../src/lib/github-app/repository";
import {
  assertValidGitHubInstallRedirectUrl,
  buildConfigureInstallationUrl,
  buildNewInstallationUrl,
  getGitHubAppSlugOrThrow,
  GitHubAppSlugError,
  installRedirectUrlHasState,
  resolveGitHubInstallRedirect,
} from "../src/lib/github-app/install-redirect";
import { assertClientGitHubInstallRedirectUrl } from "../src/lib/github-app/install-redirect-client";
import { setDurableRecord } from "../src/lib/store/durable-store";

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function withGitHubAppEnv<T>(fn: () => T | Promise<T>): Promise<T> {
  const previous = {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
    GITHUB_APP_PRIVATE_KEY_BASE64: process.env.GITHUB_APP_PRIVATE_KEY_BASE64,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
  };

  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_CLIENT_ID = "test-client-id";
  process.env.GITHUB_APP_CLIENT_SECRET = "test-client-secret";
  process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from(
    "-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----"
  ).toString("base64");
  process.env.GITHUB_APP_SLUG = "repodiet-operator";

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function run() {
  console.log("GitHub install flow tests");

  await test("state token hash is stable", () => {
    const token = "abc123";
    assert.equal(hashInstallState(token), hashInstallState(token));
    assert.notEqual(hashInstallState(token), hashInstallState("other"));
  });

  await test("install flow record expires", () => {
    const token = generateInstallStateToken();
    const record = createInstallFlowRecord({
      stateToken: token,
      sessionKey: "sess",
      repositoryFullName: "Ibrahimmovic/Circle-Arc-Net",
      owner: "Ibrahimmovic",
      repo: "Circle-Arc-Net",
      returnPath: "/app?tab=patch",
    });
    assert.equal(isInstallFlowExpired(record), false);
    const expired = {
      ...record,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    assert.equal(isInstallFlowExpired(expired), true);
  });

  await test("resolve install flow rejects invalid state", async () => {
    const resolved = await resolveInstallFlowState("missing-token");
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.reason, "invalid");
  });

  await test("resolve install flow accepts valid state once", async () => {
    const token = generateInstallStateToken();
    const record = createInstallFlowRecord({
      stateToken: token,
      sessionKey: "sess-1",
      repositoryFullName: "Ibrahimmovic/Circle-Arc-Net",
      owner: "Ibrahimmovic",
      repo: "Circle-Arc-Net",
      returnPath: "/app?tab=patch&scanId=scan_1",
    });
    await setDurableRecord("github_installations", `flow:${record.stateHash}`, record);

    const first = await resolveInstallFlowState(token);
    assert.equal(first.ok, true);

    await consumeInstallFlowState(token);
    const second = await resolveInstallFlowState(token);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "reused");
  });

  await test("installed_repo_missing copy is non-technical", () => {
    const copy = accessCopyForState("installed_repo_missing", "Circle-Arc-Net");
    assert.match(copy.title, /needs access/i);
    assert.match(copy.primaryAction ?? "", /Grant Access to Circle-Arc-Net/);
    assert.doesNotMatch(copy.body, /Settings/i);
    assert.doesNotMatch(copy.body, /Installed GitHub Apps/i);
  });

  await test("wrong_account copy directs repository owner install", () => {
    const copy = accessCopyForState("wrong_account", "Circle-Arc-Net", "Ibrahimmovic");
    assert.match(copy.body, /belongs to Ibrahimmovic/i);
    assert.match(copy.primaryAction ?? "", /Install RepoDiet as Ibrahimmovic/);
    assert.doesNotMatch(copy.primaryAction ?? "", /Grant Access/i);
  });

  await test("requiresRepositoryOwnerInstall detects owner mismatch", () => {
    assert.equal(
      requiresRepositoryOwnerInstall({
        repositoryOwner: "Ibrahimmovic",
        installationOwner: "smokychain22",
      }),
      true
    );
    assert.equal(
      requiresRepositoryOwnerInstall({
        repositoryOwner: "smokychain22",
        installationOwner: "smokychain22",
      }),
      false
    );
    assert.equal(
      requiresRepositoryOwnerInstall({
        repositoryOwner: "Ibrahimmovic",
      }),
      false
    );
  });

  await test("new install URL begins with https://github.com/apps/", () => {
    const url = buildNewInstallationUrl("repodiet-operator", "state-token");
    assert.match(url, /^https:\/\/github\.com\/apps\//);
    assert.match(url, /\/installations\/new\?state=/);
    assert.doesNotMatch(url, /settings\/apps/);
    assert.notEqual(url, "https://github.com/app");
  });

  await test("existing installation URL begins with https://github.com/settings/installations/", () => {
    const url = buildConfigureInstallationUrl(12345, "state-token");
    assert.match(url, /^https:\/\/github\.com\/settings\/installations\/12345/);
    assert.match(url, /\?state=state-token$/);
  });

  await test("resolveGitHubInstallRedirect uses configure flow for same-owner missing repo", () => {
    const stateToken = "opaque-state";
    const resolved = resolveGitHubInstallRedirect({
      slug: "repodiet-operator",
      stateToken,
      installationId: 99,
      requiresRepositoryOwnerInstall: false,
      hasRepositoryAccess: false,
    });
    assert.equal(resolved.flow, "configure");
    assert.match(resolved.url, /^https:\/\/github\.com\/settings\/installations\/99/);
    assert.equal(installRedirectUrlHasState(resolved.url, stateToken), true);
  });

  await test("resolveGitHubInstallRedirect uses install flow for owner mismatch", () => {
    const stateToken = "opaque-state";
    const resolved = resolveGitHubInstallRedirect({
      slug: "repodiet-operator",
      stateToken,
      installationId: 99,
      requiresRepositoryOwnerInstall: true,
      hasRepositoryAccess: false,
    });
    assert.equal(resolved.flow, "install");
    assert.match(resolved.url, /\/installations\/new\?state=/);
  });

  await test("URL never equals https://github.com/app", () => {
    const bad = "https://github.com/app?tab=patch&scanId=scan_1";
    assert.throws(
      () => assertValidGitHubInstallRedirectUrl(bad, "install"),
      /github\.com\/app/
    );
    assert.throws(
      () => assertClientGitHubInstallRedirectUrl(bad, "install"),
      /github\.com\/app/
    );
  });

  await test("state is preserved for new installation flow", () => {
    const stateToken = generateInstallStateToken();
    const url = buildNewInstallationUrl("repodiet-operator", stateToken);
    assert.equal(installRedirectUrlHasState(url, stateToken), true);
    assertValidGitHubInstallRedirectUrl(url, "install");
  });

  await test("invalid or missing app slug returns controlled error", async () => {
    const previous = process.env.GITHUB_APP_SLUG;
    delete process.env.GITHUB_APP_SLUG;
    try {
      assert.throws(() => getGitHubAppSlugOrThrow(), GitHubAppSlugError);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_APP_SLUG;
      else process.env.GITHUB_APP_SLUG = previous;
    }
  });

  await test("createInstallFlow persists state without relative redirect URLs", async () => {
    await withGitHubAppEnv(async () => {
      const { stateToken } = await createInstallFlow({
        sessionKey: "sess-dev",
        repositoryFullName: "Ibrahimmovic/Circle-Arc-Net",
        scanId: "scan_test",
        returnPath: "/app?tab=patch",
      });

      const resolved = resolveGitHubInstallRedirect({
        slug: getGitHubAppSlugOrThrow(),
        stateToken,
        requiresRepositoryOwnerInstall: false,
        hasRepositoryAccess: false,
      });

      assert.match(resolved.url, /^https:\/\/github\.com\//);
      assert.notEqual(resolved.url, "https://github.com/app?tab=patch");
      assert.doesNotMatch(resolved.url, /^\/app/);
    });
  });

  await test("repository full name parser", () => {
    const parsed = parseRepositoryFullName("Ibrahimmovic/Circle-Arc-Net");
    assert.equal(parsed.owner, "Ibrahimmovic");
    assert.equal(parsed.repo, "Circle-Arc-Net");
  });

  await test("expired state copy", () => {
    const copy = accessCopyForState("state_expired", "Circle-Arc-Net");
    assert.match(copy.primaryAction ?? "", /Reconnect GitHub/i);
  });

  await test("repo_not_granted recovery copy", () => {
    const copy = accessCopyForState("repo_not_granted", "Circle-Arc-Net");
    assert.match(copy.primaryAction ?? "", /Try Again/i);
  });

  await test("install callback validates installation_id, setup_action, state", () => {
    const valid = parseInstallCallbackParams(
      new URLSearchParams({
        installation_id: "12345",
        setup_action: "install",
        state: "opaque-state-token",
      })
    );
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.equal(valid.params.installationId, 12345);
      assert.equal(valid.params.setupAction, "install");
      assert.equal(valid.params.stateToken, "opaque-state-token");
    }

    const update = parseInstallCallbackParams(
      new URLSearchParams({
        installation_id: "99",
        setup_action: "update",
        state: "token-2",
      })
    );
    assert.equal(update.ok, true);
    if (update.ok) assert.equal(update.params.setupAction, "update");

    const missingInstall = parseInstallCallbackParams(
      new URLSearchParams({ setup_action: "install", state: "x" })
    );
    assert.equal(missingInstall.ok, false);
    if (!missingInstall.ok) assert.equal(missingInstall.errorCode, "missing_installation");

    const invalidInstall = parseInstallCallbackParams(
      new URLSearchParams({
        installation_id: "abc",
        setup_action: "install",
        state: "x",
      })
    );
    assert.equal(invalidInstall.ok, false);
    if (!invalidInstall.ok) assert.equal(invalidInstall.errorCode, "invalid_installation");

    const missingAction = parseInstallCallbackParams(
      new URLSearchParams({ installation_id: "1", state: "x" })
    );
    assert.equal(missingAction.ok, false);
    if (!missingAction.ok) assert.equal(missingAction.errorCode, "missing_setup_action");

    const invalidAction = parseInstallCallbackParams(
      new URLSearchParams({
        installation_id: "1",
        setup_action: "delete",
        state: "x",
      })
    );
    assert.equal(invalidAction.ok, false);
    if (!invalidAction.ok) assert.equal(invalidAction.errorCode, "invalid_setup_action");

    const missingState = parseInstallCallbackParams(
      new URLSearchParams({ installation_id: "1", setup_action: "install" })
    );
    assert.equal(missingState.ok, false);
    if (!missingState.ok) assert.equal(missingState.errorCode, "invalid_state");
  });

  console.log("All GitHub install flow tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
