/**
 * === ROW 8: verification must describe the tree that will actually ship ===
 *
 * Reproduces the exact production failure observed on repodiet-agent-9636
 * against velz-cmd/repodiet-e2e-test on 2026-08-07.
 *
 * The analyzer proposed deleting BOTH:
 *
 *   src/repodiet-verification-unused.js   genuinely unreferenced (safe)
 *   src/config/runtime-hook.ts            referenced dynamically via
 *                                         fixture.config.json (FALSE POSITIVE)
 *
 * Only the first was approved. But repository verification ran against the
 * merged patch — the whole candidate superset — so runtime-hook.ts was deleted
 * in the verified tree, the repository's own test
 * `dynamic, side-effect, config, package-export and asset references stay
 * alive` failed, `verifiedChanges` fell to 0, and the approved-safe deletion
 * could never be delivered. The base branch passes its own tests cleanly, so
 * this was NOT a pre-existing failure.
 *
 * These tests pin the corrected ordering:
 *
 *   analyze -> candidates -> classify/block -> APPROVAL SCOPE
 *           -> exact delivery operations -> VERIFY THOSE -> PR
 *
 * Nothing here weakens the safety model, and the Case B test exists to prove
 * that: a false positive that IS selected for delivery is still applied to the
 * verified tree and must still fail closed.
 */
import assert from "node:assert/strict";
import { resolveVerificationDeliveryScope } from "../src/lib/patch-kit/verification-delivery-scope";

const SAFE = "src/repodiet-verification-unused.js";
const FALSE_POSITIVE = "src/config/runtime-hook.ts";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

async function run() {
  console.log("delivery-scoped verification");

  // ------------------------------------------------------------- CASE A ----
  await test(
    "CASE A: an approved safe deletion is verified WITHOUT the unapproved false positive",
    () => {
      const scope = resolveVerificationDeliveryScope({
        changeOperations: [
          { type: "delete", filePath: SAFE },
          { type: "delete", filePath: FALSE_POSITIVE },
        ],
        edits: [],
        approvedDeletePaths: [SAFE],
      });

      assert.deepEqual(scope.deletePaths, [SAFE], "only the approved deletion may be verified");
      assert.ok(
        !scope.deletePaths.includes(FALSE_POSITIVE),
        "the unapproved false positive must never reach the verified tree"
      );
      assert.deepEqual(
        scope.excludedDeletePaths,
        [FALSE_POSITIVE],
        "the excluded candidate must be reported, not silently dropped"
      );
    }
  );

  // ------------------------------------------------------------- CASE B ----
  await test(
    "CASE B: a false positive that IS approved still reaches verification, so it can fail closed",
    () => {
      const scope = resolveVerificationDeliveryScope({
        changeOperations: [{ type: "delete", filePath: FALSE_POSITIVE }],
        edits: [],
        approvedDeletePaths: [FALSE_POSITIVE],
      });

      // This is the load-bearing half of the fix. Scoping verification to the
      // delivery set must NOT become a way to skip verifying something risky:
      // if it ships, it is verified, and the repository's own tests decide.
      assert.deepEqual(
        scope.deletePaths,
        [FALSE_POSITIVE],
        "a selected candidate must still be applied to the verified tree"
      );
      assert.deepEqual(scope.excludedDeletePaths, []);
    }
  );

  // ------------------------------------------------------------- CASE C ----
  await test(
    "CASE C: an unrelated unapproved analyzer finding does not poison the approved patch",
    () => {
      const scope = resolveVerificationDeliveryScope({
        changeOperations: [
          { type: "delete", filePath: SAFE },
          { type: "delete", filePath: "src/lib/orphan-a.ts" },
          { type: "delete", filePath: "src/lib/unused-helper.ts" },
          { type: "delete", filePath: FALSE_POSITIVE },
        ],
        edits: [{ path: "src/keeps-an-edit.ts", content: "export const x = 1;\n" }],
        approvedDeletePaths: [SAFE],
      });

      assert.ok(scope.deletePaths.includes(SAFE), "the approved deletion still ships");
      assert.ok(
        !scope.deletePaths.includes(FALSE_POSITIVE),
        "an unapproved candidate cannot enter the verified tree"
      );
      assert.deepEqual(
        scope.edits.map((e) => e.path),
        ["src/keeps-an-edit.ts"],
        "unrelated content edits are unaffected"
      );
    }
  );

  // --------------------------------------------------- deletion-as-edit ----
  await test(
    "an EXCLUDED deletion encoded as an empty-content edit is dropped from the edits too",
    () => {
      const scope = resolveVerificationDeliveryScope({
        changeOperations: [],
        // Empty content IS a deletion. Excluding it from deletePaths while
        // leaving it here would truncate the file instead of deleting it —
        // breaking the repository just as effectively.
        edits: [
          { path: FALSE_POSITIVE, content: "" },
          { path: SAFE, content: "" },
        ],
        approvedDeletePaths: [SAFE],
      });

      assert.ok(
        !scope.edits.some((e) => e.path === FALSE_POSITIVE),
        "an excluded deletion must not survive as an empty-content edit"
      );
      assert.ok(scope.deletePaths.includes(SAFE), "the approved deletion still ships");
    }
  );

  await test("the delivered patch matches the delivery scope exactly — no extras", () => {
    const scope = resolveVerificationDeliveryScope({
      changeOperations: [
        { type: "delete", filePath: SAFE },
        { type: "delete", filePath: FALSE_POSITIVE },
      ],
      edits: [{ path: "src/edited.ts", content: "export const a = 1;\n" }],
      approvedDeletePaths: [SAFE],
    });

    const delivered = new Set([...scope.deletePaths, ...scope.edits.map((e) => e.path)]);
    assert.deepEqual(
      [...delivered].sort(),
      [SAFE, "src/edited.ts"].sort(),
      "the verified tree must contain exactly the delivered operations"
    );
  });

  await test("path normalization cannot be used to smuggle an unapproved deletion", () => {
    const scope = resolveVerificationDeliveryScope({
      changeOperations: [{ type: "delete", filePath: "./src/config/runtime-hook.ts" }],
      edits: [],
      // Approval is for a DIFFERENT file; the ./-prefixed candidate must not match.
      approvedDeletePaths: [SAFE],
    });
    assert.deepEqual(scope.deletePaths, [], "no unapproved deletion may be selected");
    assert.deepEqual(scope.excludedDeletePaths, [FALSE_POSITIVE]);
  });

  await test("an approval written with a ./ prefix still matches its candidate", () => {
    const scope = resolveVerificationDeliveryScope({
      changeOperations: [{ type: "delete", filePath: SAFE }],
      edits: [],
      approvedDeletePaths: [`./${SAFE}`],
    });
    assert.deepEqual(scope.deletePaths, [SAFE], "normalized approval must match");
  });

  await test("no approvals at all means operator-safe defaults only", () => {
    const scope = resolveVerificationDeliveryScope({
      changeOperations: [{ type: "delete", filePath: FALSE_POSITIVE }],
      edits: [],
    });
    assert.deepEqual(
      scope.deletePaths,
      [],
      "an un-approved, non-operator-safe candidate must never be verified as delivered"
    );
  });

  // ------------------------------------------- machine-wide boundary ------
  console.log(" one canonical heavy-work admission boundary");

  /**
   * `runExclusiveHeavyJob` was documented as "machine-wide admission control"
   * but was applied at ONE call site, while `createCleanupPullRequest` had
   * seven other callers that reached the heavy pipeline with no limiter at
   * all — including the production verification script, which is how a proof
   * run and the live agent could contend for the same 1-vCPU box.
   *
   * These are structural, not behavioural: the failure mode is a NEW caller
   * silently opting out, which no runtime test can catch.
   */
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
    }
    return out;
  }

  const sourceFiles = [...walk("src"), ...walk("scripts")];

  await test("no production module reaches the cleanup pipeline outside the boundary", () => {
    const offenders = sourceFiles.filter((file) => {
      if (file.replace(/\\/g, "/").endsWith("src/lib/operator/create-cleanup-pr.ts")) return false;
      return readFileSync(file, "utf8").includes("createCleanupPullRequestUnlocked");
    });
    assert.deepEqual(
      offenders,
      [],
      `these modules bypass the machine-wide heavy-work boundary: ${offenders.join(", ")}`
    );
  });

  await test("the public entry point acquires the heavy slot", () => {
    const src = readFileSync("src/lib/operator/create-cleanup-pr.ts", "utf8");
    assert.ok(
      /export async function createCleanupPullRequest\(input: CreateCleanupPrInput\) \{[\s\S]{0,400}?runExclusiveHeavyJob\(/.test(
        src
      ),
      "createCleanupPullRequest must acquire the machine-wide heavy slot"
    );
  });

  await test("NO DOUBLE LOCK: no caller wraps the boundary in a second heavy slot", () => {
    const offenders = sourceFiles.filter((file) => {
      const normalized = file.replace(/\\/g, "/");
      if (normalized.endsWith("src/lib/operator/create-cleanup-pr.ts")) return false;
      if (normalized.endsWith("src/lib/okx-runtime/heavy-job-limiter.ts")) return false;
      return readFileSync(file, "utf8").includes("runExclusiveHeavyJob");
    });
    // A nested acquisition would observe the outer slot and reject itself with
    // `heavy_job_already_running` — a self-deadlock wearing admission
    // control's clothes.
    assert.deepEqual(
      offenders,
      [],
      `these modules would double-lock the heavy slot: ${offenders.join(", ")}`
    );
  });

  console.log(
    failures === 0
      ? "delivery-scoped-verification: all passed"
      : `delivery-scoped-verification: ${failures} FAILED`
  );
  if (failures > 0) process.exit(1);
}

void run();
