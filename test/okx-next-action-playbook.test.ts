/**
 * Both fixtures below are VERBATIM `onchainos agent next-action` stdout,
 * captured live against production job
 * 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6 on
 * 2026-08-03 — not hand-written approximations. Pinning the real CLI output
 * is the whole point: this parser exists because that output is already a
 * deterministic decision, and a fixture drift here is exactly the kind of
 * regression that would silently reintroduce the Gemini dependency.
 */
import assert from "node:assert/strict";
import {
  fillNotifyTemplate,
  flattenForCliArgument,
  parseNextActionPlaybook,
} from "../src/lib/okx-runtime/next-action-playbook";

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const JOB_ASP_SELECTED_SKIP = `[Current state] job_asp_selected — designated by User Agent, but no specific \`serviceId\` was pinned. jobId=\`0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6\` agentId=9636

**Notify the user, then end the turn**:

🌐 **Localize first** — rewrite the content below in the user's language before sending. Do NOT pass the English template verbatim to a non-English user.
\`\`\`bash
onchainos agent user-notify --content "<localized content shown below>"
\`\`\`
content:
[Designated Task — Skipped] Job 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6 — the User Agent designated you as the ASP without pinning a specific service.
  No action taken; waiting for the User Agent to re-route with a specific service.
`;

const JOB_ACCEPTED = `[Current state] job_accepted (User Agent has confirmed the apply)
[Role] ASP (Agent Service ASP)

[Your next action (strict order, do not skip steps)]

**Load task context first**:
\`\`\`bash
onchainos agent common context 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6 --role asp --agent-id 9636
\`\`\`
Extract title + description + tokenAmount + tokenSymbol + serviceParams + buyerAgentId (needed below).

**Step 1 — Notify the user (apply accepted) via \`onchainos agent user-notify\`**:

🌐 **Localize first** — rewrite the content below in the user's language before sending. Do NOT pass the English template verbatim to a non-English user.
\`\`\`bash
onchainos agent user-notify --content "<localized content shown below>"
\`\`\`
content:
    [Job Accepted] Job 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6 has been accepted.
    - Title: <title>
    - Description: <description>
    - Negotiated price: <tokenAmount> <tokenSymbol>
    - Payment: <escrow>
    - ASP: 9636
    Funds are now escrowed; the ASP has started execution.

Fill the \`<title>\` / \`<description>\` / \`<tokenAmount>\` / \`<tokenSymbol>\` placeholders from the **Task fields** block above.
⚠️ Do NOT send \`okx-a2a xmtp-send\` \`received apply confirmation\` filler to the User Agent — the User Agent just ran confirm-accept; they already know.

**Step 2 — Autonomously execute the task and prepare the deliverable**:
Pick the right tool / capability for the task content to get the work done. For example:
  • \`Generate a cat image\` → call an image-generation tool, get the local file path
  • \`Check the weather\` → call wttr.in / a weather API, get a text result
  • \`Audit a smart contract\` → read the code, produce an audit report
Tool choice is outside the script's scope; the agent decides autonomously.

**Step 3 — Deliver** (single CLI command):
\`\`\`bash
onchainos agent deliver 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6 --file "<local file path>" --agent-id 9636
\`\`\`

**Step 4 — After Step 3 ends this turn immediately**.

[Follow-up events]
- \`job_completed\` (User Agent reviewed and accepted) — auto-rate the User Agent + notify the user
- \`job_rejected\`  (User Agent rejected the deliverable) — push dispute-vs-refund decision to the user
`;

async function run() {
  console.log("okx-next-action-playbook");

  await test("a notify-only playbook (job_asp_selected skip case) is recognized deterministically", () => {
    const plan = parseNextActionPlaybook(JOB_ASP_SELECTED_SKIP);
    assert.equal(plan.kind, "notify_only");
    if (plan.kind !== "notify_only") return;
    assert.match(plan.content, /\[Designated Task — Skipped\]/);
    assert.match(plan.content, /waiting for the User Agent to re-route/);
  });

  await test("the job_accepted playbook is recognized and its Step 1 template extracted", () => {
    const plan = parseNextActionPlaybook(JOB_ACCEPTED);
    assert.equal(plan.kind, "job_accepted_execute");
    if (plan.kind !== "job_accepted_execute") return;
    assert.match(plan.notifyTemplate, /\[Job Accepted\]/);
    assert.match(plan.notifyTemplate, /<title>/);
    assert.match(plan.notifyTemplate, /<tokenAmount>/);
    // Step 2/3/4 text must NOT leak into the extracted Step 1 content.
    assert.doesNotMatch(plan.notifyTemplate, /Autonomously execute/);
  });

  await test("an unfamiliar playbook shape is reported, never guessed", () => {
    assert.deepEqual(parseNextActionPlaybook("Something the CLI has never printed before."), {
      kind: "unrecognized",
    });
    assert.deepEqual(parseNextActionPlaybook(""), { kind: "unrecognized" });
  });

  await test("a playbook with two commands (not the known single-notify shape) is not misread as notify-only", () => {
    const twoCommands = `\`\`\`bash\nonchainos agent user-notify --content "x"\n\`\`\`\ncontent:\nhi\n\`\`\`bash\nonchainos agent deliver x\n\`\`\`\n`;
    assert.deepEqual(parseNextActionPlaybook(twoCommands), { kind: "unrecognized" });
  });

  // Incident #40: job 0xba4de4f5..., a designated A2A provider with
  // isDirectCommunication:true, returned job_asp_selected/provider_applied
  // playbooks carrying an extra fenced block alongside the notify one — the
  // exact two-command shape above, but for an event whose ENTIRE contract
  // (per JOB_ASP_SELECTED_SKIP) is "notify and end the turn", so the extra
  // block is never actually executed by the caller either way. Scoped to
  // just these two event names, never a general relaxation.
  await test("a job_asp_selected playbook with an extra fenced block alongside the notify one is still recognized as notify-only", () => {
    const withExtraBlock = `\`\`\`bash\nonchainos agent user-notify --content "x"\n\`\`\`\ncontent:\nhi\n\`\`\`bash\nonchainos some-unrelated-probe-command\n\`\`\`\n`;
    const plan = parseNextActionPlaybook(withExtraBlock, "job_asp_selected");
    assert.equal(plan.kind, "notify_only");
    if (plan.kind !== "notify_only") return;
    assert.equal(plan.content, "hi");
  });

  await test("a provider_applied playbook with an extra fenced block alongside the notify one is also recognized as notify-only", () => {
    const withExtraBlock = `\`\`\`bash\nonchainos agent user-notify --content "x"\n\`\`\`\ncontent:\nhi\n\`\`\`bash\nonchainos some-unrelated-probe-command\n\`\`\`\n`;
    const plan = parseNextActionPlaybook(withExtraBlock, "provider_applied");
    assert.equal(plan.kind, "notify_only");
    if (plan.kind !== "notify_only") return;
    assert.equal(plan.content, "hi");
  });

  await test("the extra-block allowance does not extend to events outside the known notify-only set", () => {
    const withExtraBlock = `\`\`\`bash\nonchainos agent user-notify --content "x"\n\`\`\`\ncontent:\nhi\n\`\`\`bash\nonchainos agent deliver x\n\`\`\`\n`;
    assert.deepEqual(parseNextActionPlaybook(withExtraBlock, "job_completed"), { kind: "unrecognized" });
  });

  await test("a job_asp_selected playbook with extra blocks but NO notify block among them is still unrecognized, never guessed", () => {
    const noNotifyBlock = `\`\`\`bash\nonchainos agent deliver x\n\`\`\`\n\`\`\`bash\nonchainos some-unrelated-probe-command\n\`\`\`\n`;
    assert.deepEqual(parseNextActionPlaybook(noNotifyBlock, "job_asp_selected"), { kind: "unrecognized" });
  });

  await test("fillNotifyTemplate substitutes every placeholder from authoritative fields", () => {
    const filled = fillNotifyTemplate("Price: <tokenAmount> <tokenSymbol>, title <title>", {
      tokenAmount: "1",
      tokenSymbol: "USDT",
      title: "RepoDiet Verified Cleanup",
    });
    assert.equal(filled, "Price: 1 USDT, title RepoDiet Verified Cleanup");
  });

  await test("fillNotifyTemplate never drops a placeholder silently when data is missing", () => {
    const filled = fillNotifyTemplate("Desc: <description>", {});
    assert.equal(filled, "Desc: unknown");
  });

  await test("flattenForCliArgument removes newlines so the authorization boundary's metacharacter check passes", () => {
    const flattened = flattenForCliArgument("Line one\n  Line two\n\nLine three");
    assert.doesNotMatch(flattened, /\n/);
    assert.equal(flattened, "Line one Line two Line three");
  });

  console.log("okx-next-action-playbook: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
