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
} from "../src/lib/github-app/install-flow";
import { parseInstallCallbackParams } from "../src/lib/github-app/install-callback";
import { accessCopyForState } from "../src/lib/github-app/access-states";
import { parseRepositoryFullName } from "../src/lib/github-app/repository";
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
