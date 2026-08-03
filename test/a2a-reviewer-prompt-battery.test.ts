import assert from "node:assert/strict";
import {
  isInformationalQuery,
  inferCleanupTaskTypeFromText,
} from "../src/lib/a2a/marketplace-intake";
import { POST } from "../src/app/api/a2a/tasks/route";

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

/**
 * OKX's standard reviewer prompts, run against the real intake route.
 *
 * Reproduced live against production on 2026-08-02: three of the five
 * returned HTTP 400 "could not map it to a cleanup task type", including
 * "The task is: type=create_cleanup_pr." — verbatim OKX rejection class #6
 * ("a reviewer explicitly stated create_cleanup_pr, but the task was
 * incorrectly rejected as unmappable").
 *
 * PR #141 taught the OpenClaw bridge to classify intent and forward a `type`,
 * but that only covers XMTP traffic routed through the bridge. The intake
 * endpoint itself still could not read prose, so every other caller kept
 * getting the rejected-as-unmappable answer. These tests pin the behaviour at
 * the server, where it cannot depend on which client is calling.
 */
async function post(body: Record<string, unknown>) {
  const res = await POST(
    new Request("https://skillswap-virid-kappa.vercel.app/api/a2a/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function run() {
  console.log("a2a-reviewer-prompt-battery");

  // --- the "you"-form discovery question --------------------------------

  await test('"What services do you offer?" is recognised as a discovery question', () => {
    assert.equal(isInformationalQuery("What services do you offer?"), true);
    assert.equal(isInformationalQuery("Which services do you provide?"), true);
    assert.equal(isInformationalQuery("What do you do?"), true);
  });

  await test("the pre-existing RepoDiet-named discovery forms still work", () => {
    assert.equal(isInformationalQuery("Is RepoDiet online?"), true);
    assert.equal(isInformationalQuery("What does RepoDiet do?"), true);
    assert.equal(isInformationalQuery("What services does RepoDiet offer?"), true);
  });

  await test("a discovery question is NOT mistaken for a cleanup task", () => {
    assert.equal(inferCleanupTaskTypeFromText("What services do you offer?"), undefined);
    assert.equal(inferCleanupTaskTypeFromText("Is RepoDiet online?"), undefined);
    assert.equal(inferCleanupTaskTypeFromText(""), undefined);
    assert.equal(inferCleanupTaskTypeFromText(undefined), undefined);
  });

  // --- cleanup intent stated in prose ------------------------------------

  await test("a stated cleanup intent is inferred, including the underscore form", () => {
    // "_" is a word character, so \bcleanup\b cannot match inside
    // "create_cleanup_pr" — the exact trap that defeated the first bridge fix.
    assert.equal(
      inferCleanupTaskTypeFromText("The task is: type=create_cleanup_pr."),
      "repository.safe_cleanup"
    );
    assert.equal(
      inferCleanupTaskTypeFromText("I need a safe cleanup pull request for my JavaScript repository."),
      "repository.safe_cleanup"
    );
    assert.equal(
      inferCleanupTaskTypeFromText("Please open a PR for me"),
      "repository.safe_cleanup"
    );
    assert.equal(
      inferCleanupTaskTypeFromText("repository.verified_cleanup please"),
      "repository.safe_cleanup"
    );
  });

  // --- the full reviewer battery against the real route ------------------

  await test("every OKX reviewer prompt gets a useful answer, never INVALID_TASK_TYPE", async () => {
    const prompts = [
      "I would like to use the services of agent ID 9636.",
      "Is RepoDiet online?",
      "What services do you offer?",
      "I need a safe cleanup pull request for my JavaScript repository.",
      "The task is: type=create_cleanup_pr.",
    ];
    for (const message of prompts) {
      const { status, body } = await post({ message });
      assert.notEqual(
        body.code,
        "INVALID_TASK_TYPE",
        `"${message}" must never be rejected as unmappable — this is OKX rejection class #6`
      );
      assert.ok(
        typeof body.message === "string" && (body.message as string).trim().length > 0,
        `"${message}" must receive a non-empty, useful reply`
      );
      // Either an informative 200, or an honest "tell me the repository" ask.
      assert.ok(
        status === 200 || body.code === "SCOPE_REQUIRED",
        `"${message}" returned status ${status} code ${String(body.code)}`
      );
    }
  });

  await test("a cleanup request without a repository asks for the repository, not a rejection", async () => {
    const { body } = await post({ message: "The task is: type=create_cleanup_pr." });
    assert.equal(body.code, "SCOPE_REQUIRED");
    assert.equal(body.marketplaceLifecycle, "WAITING_FOR_REPOSITORY");
    assert.match(String(body.message), /repository URL/i);
  });

  /**
   * Reproduced live against production on 2026-08-03, AFTER the earlier
   * unmappable-type fixes shipped: naming a REGISTERED SERVICE still returned
   * HTTP 400 INVALID_TASK_TYPE — "could not map it to a cleanup task type" — to
   * a caller who had just named the service by its marketplace name. Asking how
   * to authorize a repository failed the same way. Both are standard pre-work
   * reviewer prompts and both are the rejection class OKX raised twice.
   */
  await test("naming a registered service is answered, never rejected as unmappable", async () => {
    for (const message of [
      "I would like RepoDiet Quick Triage",
      "I would like RepoDiet Verified Cleanup",
      "Please run analyze_repository",
      "service 37347 please",
    ]) {
      const { status, body } = await post({ message });
      assert.notEqual(body.code, "INVALID_TASK_TYPE", `must not reject: ${message}`);
      assert.equal(status, 200, `must answer: ${message}`);
      assert.equal(body.acknowledged, true);
    }
  });

  await test("Quick Triage is answered as A2MCP 37347, never coerced into a cleanup task", async () => {
    const { body } = await post({ message: "I would like RepoDiet Quick Triage" });
    // Quick Triage is a read-only A2MCP service. Mapping it to the escrow-backed
    // cleanup type would misprice and misrepresent it.
    assert.notEqual(body.taskType, "repository.safe_cleanup");
    assert.match(String(body.message), /37347|quick\s*triage/i);
  });

  await test("a repository-authorization question gets a deterministic answer", async () => {
    for (const message of [
      "How do I authorize a repository?",
      "How can I grant you access?",
      "What permissions do you need?",
    ]) {
      const { status, body } = await post({ message });
      assert.equal(status, 200, `must answer: ${message}`);
      assert.notEqual(body.code, "INVALID_TASK_TYPE", `must not reject: ${message}`);
    }
  });

  await test("a real cleanup request with a repository still becomes a task", async () => {
    // The informational branches are guarded on `!repoUrl`, so widening them
    // must not swallow genuine work. This is the regression that would matter.
    const { body } = await post({
      message: "I would like RepoDiet Verified Cleanup for https://github.com/velz-cmd/repodiet-e2e-test",
    });
    assert.notEqual(body.code, "INVALID_TASK_TYPE");
    assert.notEqual(
      body.marketplaceLifecycle,
      "AVAILABLE",
      "a request carrying a repository must not be answered as mere discovery"
    );
  });

  await test("genuinely unmappable input is still refused — the gate is not simply removed", async () => {
    const { body } = await post({ message: "banana" });
    assert.equal(
      body.code,
      "INVALID_TASK_TYPE",
      "unrelated text must not be silently coerced into a cleanup task"
    );
  });

  console.log("a2a-reviewer-prompt-battery: all passed");
}

run();
