/**
 * Unit tests for the RepoDiet A2A Bridge OpenClaw plugin's decision logic
 * (openclaw-plugins/repodiet-a2a-bridge/logic.js). Tests against the
 * verified openclaw@2026.7.1-2 `before_agent_reply` hook contract
 * (event.cleanedBody, ctx.sessionKey, and the { handled, reply, reason }
 * result shape). logic.js has no dependency on the "openclaw" package, so
 * this runs unconditionally, unlike index.js which only the real OpenClaw
 * runtime can load. Not part of `npm test` yet: the plugin itself is not
 * wired into the container's startup config (see index.js's docblock), so
 * this suite is run and reported separately until that activation lands.
 */
import assert from "node:assert/strict";
import {
  decideReply,
  isSellerSession,
  isMarketplaceDiscoveryMessage,
  isInformationalQuery,
  SAFE_REPLY,
  ESCALATION_REPLY,
} from "../openclaw-plugins/repodiet-a2a-bridge/logic.js";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function run() {
  console.log("repodiet-a2a-bridge");

  test("isSellerSession matches the exact okx-a2a seller sessionKey pattern (my:9636:to:<peer>)", () => {
    assert.equal(isSellerSession("my:9636:to:5295"), true);
    assert.equal(isSellerSession("my:1234:to:5295"), false);
    assert.equal(isSellerSession("to:9636:my:5295"), false);
    assert.equal(isSellerSession(undefined), false);
  });

  test("decideReply ignores sessions that are not an Agent 9636 seller exchange", () => {
    const result = decideReply({ cleanedBody: "hello" }, { sessionKey: "my:1234:to:5295" });
    assert.equal(result, undefined);
  });

  test("decideReply answers a known discovery message with the fixed SAFE_REPLY template, never model text", () => {
    const result = decideReply(
      { cleanedBody: "I would like to use the services of agent ID 9636" },
      { sessionKey: "my:9636:to:5295" }
    );
    assert.ok(result);
    assert.equal(result!.handled, true);
    assert.equal(result!.reply?.text, SAFE_REPLY);
    assert.equal(result!.reason, "repodiet_safe_pattern_match");
  });

  test("decideReply answers a known informational question with the fixed SAFE_REPLY template", () => {
    const result = decideReply({ cleanedBody: "Is RepoDiet online?" }, { sessionKey: "my:9636:to:5295" });
    assert.ok(result);
    assert.equal(result!.reply?.text, SAFE_REPLY);
  });

  test("decideReply escalates deterministically instead of ever falling through to a model call", () => {
    const result = decideReply(
      { cleanedBody: "please start the cleanup and open a PR now" },
      { sessionKey: "my:9636:to:5295" }
    );
    assert.ok(result);
    assert.equal(result!.handled, true, "must claim the turn — never let the underlying model answer OKX traffic");
    assert.equal(result!.reply?.text, ESCALATION_REPLY);
    assert.equal(result!.reason, "repodiet_seller_session_escalation");
  });

  test("decideReply always sets handled:true for any seller-session message, matched or not", () => {
    for (const body of ["", "asdkjaslkdj random text", "what is the weather"]) {
      const result = decideReply({ cleanedBody: body }, { sessionKey: "my:9636:to:5295" });
      assert.equal(result?.handled, true, `expected handled:true for body=${JSON.stringify(body)}`);
    }
  });

  test("classification helpers mirror src/lib/a2a/marketplace-intake.ts's proven patterns", () => {
    assert.equal(isMarketplaceDiscoveryMessage("hire agent 9636"), true);
    assert.equal(isInformationalQuery("what is the price?"), true);
    assert.equal(isMarketplaceDiscoveryMessage(""), false);
    assert.equal(isInformationalQuery(""), false);
  });

  test("no reply template ever contains a secret-shaped value", () => {
    for (const reply of [SAFE_REPLY, ESCALATION_REPLY]) {
      assert.ok(!/token|secret|key|password/i.test(reply));
    }
  });

  console.log("repodiet-a2a-bridge: all passed");
}

run();
