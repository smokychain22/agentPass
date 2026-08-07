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

  /**
   * This assertion was re-pointed on 2026-08-07, NOT relaxed.
   *
   * It previously required `code: "INVALID_TASK_TYPE"` for "banana", under the
   * stated intent "unrelated text must not be silently coerced into a cleanup
   * task". That intent is exactly right and is fully preserved below — what
   * changed is that the route now expresses it by DESCRIBING ITSELF instead of
   * returning HTTP 400.
   *
   * The 400 was never the safety property; not creating work was. And the 400
   * carried a real cost: the same branch that rejected "banana" also rejected
   * "I have a GitHub repository with dead code. Can RepoDiet help?" live in
   * production, which is a paying customer and an OKX reviewer, not noise. A
   * marketplace agent that answers an unrecognised sentence with "I could not
   * map that" fails review; one that answers with what it does, does not.
   *
   * So the assertions here now check the thing that actually matters — no
   * task, no scan, no payment, no coercion into a cleanup type — for input
   * with no conceivable cleanup intent.
   */
  await test("genuinely unmappable input still creates NO task and starts NO work — it is answered, not acted on", async () => {
    const { status, body } = await post({ message: "banana" });
    assert.equal(status, 200, "an unrecognised sentence is answered, not refused");
    assert.equal(
      body.classification,
      "unclassified_conversational_message",
      "it must go through the explicit fallback, not be mistaken for a real request"
    );
    assert.equal(body.taskId, undefined, "unrelated text must not create a task");
    assert.equal(body.scanStarted, false, "unrelated text must not start a scan");
    assert.equal(body.requestedTaskType, undefined, "unrelated text must not acquire a cleanup type");
    assert.equal(
      (body.taskPolicy as Record<string, unknown>)?.startWork,
      false,
      "unrelated text must never authorise work"
    );
  });

  /**
   * Reproduced live against production on 2026-08-03, using the buyer's own
   * genuine test account: "What is the current status of my task?" — one of
   * the standard reviewer prompts this project's own instructions have always
   * listed for testing — returned HTTP 400 INVALID_TASK_TYPE. It had never
   * actually been exercised against production before that session.
   */
  await test("a task-status question is answered, never rejected as unmappable", async () => {
    for (const message of [
      "What is the current status of my task?",
      "What's the status of my task?",
      "Can you check the task status?",
      "current status please",
    ]) {
      const { status, body } = await post({ message });
      assert.notEqual(body.code, "INVALID_TASK_TYPE", `must not reject: ${message}`);
      assert.equal(status, 200, `must answer: ${message}`);
      assert.equal(body.acknowledged, true);
    }
  });

  await test("a status question with no taskId explains how to supply one, never fabricates a status", async () => {
    const { body } = await post({ message: "What is the current status of my task?" });
    assert.equal(body.taskId, null);
    assert.match(String(body.message), /task id|taskId/i);
    assert.doesNotMatch(String(body.message), /\b(DELIVERED|ACCEPTED|EXECUTING|VALIDATING)\b/);
  });

  await test("a status question WITH a taskId points at the real per-task endpoint", async () => {
    const { body } = await post({ message: "What is the status of my task?", taskId: "task_abc123" });
    assert.equal(body.taskId, "task_abc123");
    assert.match(String(body.statusUrl), /\/api\/a2a\/tasks\/task_abc123$/);
    assert.match(String(body.message), /task_abc123/);
  });

  await test("a status question with a repository still becomes a real task, not a status answer", async () => {
    const { body } = await post({
      message: "What is the status of my task? Please clean up https://github.com/velz-cmd/repodiet-e2e-test",
    });
    assert.notEqual(body.code, "INVALID_TASK_TYPE");
    assert.notEqual(
      body.marketplaceLifecycle,
      "AVAILABLE",
      "a request carrying a repository must not be answered as mere discovery/status guidance"
    );
  });

  // --- the unclassified-message fallback (2026-08-07) --------------------

  /**
   * Every INVALID_TASK_TYPE rejection so far was fixed by appending one more
   * regex to marketplace-intake.ts — three separate rounds, each after a
   * reviewer hit a phrasing nobody had listed. That can only ever catch
   * phrasings someone already thought of.
   *
   * Reproduced live against production on 2026-08-07, one of the three
   * messages this repair was asked to prove: "I have a GitHub repository with
   * dead code. Can RepoDiet help?" returned HTTP 400, "could not map it to a
   * cleanup task type" — an ordinary prospective-customer sentence answered
   * with a rejection. The route now answers ANY unclassified human message
   * informatively, so the next unanticipated phrasing is a useful reply rather
   * than the next rejected review.
   */
  await test("the three marketplace reviewer messages are all answered, none rejected", async () => {
    for (const message of [
      "I would like to use the services of agent ID 9636",
      "What services do you provide?",
      "I have a GitHub repository with dead code. Can RepoDiet help?",
    ]) {
      const { status, body } = await post({ message });
      assert.equal(status, 200, `must answer with 200: ${message}`);
      assert.notEqual(body.code, "INVALID_TASK_TYPE", `must not reject: ${message}`);
      assert.equal(body.acknowledged, true, `must acknowledge: ${message}`);
      const text = String(body.message ?? "");
      assert.ok(text.length > 0, `must say something: ${message}`);
      assert.match(text, /RepoDiet/, `must identify itself: ${message}`);
    }
  });

  await test("an unclassified message gets the service description, and is labelled as the fallback rather than passing as a pattern match", async () => {
    const { status, body } = await post({
      message: "I have a GitHub repository with dead code. Can RepoDiet help?",
    });
    assert.equal(status, 200);
    assert.equal(body.classification, "unclassified_conversational_message");
    const text = String(body.message);
    // The reply must actually be useful: both services, and what to send next.
    assert.match(text, /37347/, "must name the A2MCP service");
    assert.match(text, /37348/, "must name the A2A service");
    assert.match(text, /repository/i, "must say what input is needed");
  });

  await test("the fallback never starts work or demands payment — it is a conversation, not a task", async () => {
    // Deliberately free of any cleanup/PR wording: a message that DOES state
    // cleanup intent must keep routing to the real cleanup path, and is
    // covered separately above.
    const { body } = await post({ message: "Hello, I am evaluating agents for my project." });
    assert.equal(body.scanStarted, false);
    assert.equal(body.paymentRequired, false);
    assert.equal((body.taskPolicy as Record<string, unknown>)?.startWork, false);
    assert.equal(body.taskId, undefined, "no task may be created by a conversational reply");
  });

  await test("an EXPLICIT unsupported type is still a hard error — a structured contract violation is reported, not papered over", async () => {
    const { status, body } = await post({ message: "do this", type: "repository.delete_everything" });
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_TASK_TYPE");
    assert.match(String(body.message), /repository\.delete_everything/, "must name the rejected type");
    assert.ok(Array.isArray(body.supportedTypes), "must tell the caller what IS supported");
  });

  await test("a request carrying neither a message nor a repository is still a 400, not a cheerful non-answer", async () => {
    const { status, body } = await post({});
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_TASK_TYPE");
  });

  await test("the fallback never swallows a real repository request", async () => {
    const { body } = await post({
      message: "Some phrasing nobody anticipated, repo https://github.com/velz-cmd/repodiet-e2e-test",
    });
    assert.notEqual(
      body.classification,
      "unclassified_conversational_message",
      "a message carrying a repository must continue into real task intake"
    );
  });

  console.log("a2a-reviewer-prompt-battery: all passed");
}

run();
