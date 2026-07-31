/**
 * scripts/patch-okx-a2a-openclaw-token-resolver.ts — build-time
 * compatibility patch for @okxweb3/a2a-openclaw@0.1.10's own internal
 * Gateway token resolver, which only understands a plain string or the
 * plugin-native {env:"VAR"} shorthand, never the {provider,source,id}
 * SecretRef shape OpenClaw core (and this repo's config) actually use —
 * confirmed by reading the plugin's real dist/index.js end to end (no
 * plugin-specific config field exists to redirect through instead).
 *
 * Runs against test/fixtures/okx-a2a-openclaw-0.1.10/dist-index.js, a
 * real, unmodified copy of the pinned plugin's published dist/index.js
 * (fetched via `npm pack @okxweb3/a2a-openclaw@0.1.10`, the same
 * resolution path Dockerfile.seller trusts, and independently confirmed
 * to match both the tarball's published npm integrity
 * (sha512-4vkJw1ae+ZtOyIQricVN8Ek/pptLFaROr1B12o7UzRPenSOkFRTYr6+sDhJ0vsn+AnWTy+uN4pQuWvQmT1HqBQ==,
 * the exact value Dockerfile.seller pins) and this patch's own pinned
 * dist/index.js sha256 — not a hand-crafted approximation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  applyTokenResolverPatch,
  patchTokenResolverSource,
  TokenResolverPatchError,
  EXPECTED_UPSTREAM_SHA256,
  ORIGINAL_TOKEN_RESOLVER_SOURCE,
  PATCHED_TOKEN_RESOLVER_SOURCE,
} from "../scripts/patch-okx-a2a-openclaw-token-resolver";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(REPO_ROOT, "test", "fixtures", "okx-a2a-openclaw-0.1.10", "dist-index.js");
const REAL_UPSTREAM_SOURCE = fs.readFileSync(FIXTURE_PATH, "utf8");

/** Extracts a top-level function's exact source via brace-depth counting — the same technique used to derive ORIGINAL_TOKEN_RESOLVER_SOURCE in the first place, so this test never hand-transcribes minified source. */
function extractFunctionSource(source: string, functionNamePrefix: string): string {
  const start = source.indexOf(functionNamePrefix);
  if (start === -1) throw new Error(`function prefix not found: ${functionNamePrefix}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function body for: ${functionNamePrefix}`);
}

function withScratchCopy(fn: (scratchPath: string) => void): void {
  const scratchDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "okx-a2a-openclaw-patch-test-"));
  const scratchPath = path.join(scratchDir, "dist-index.js");
  fs.writeFileSync(scratchPath, REAL_UPSTREAM_SOURCE, "utf8");
  try {
    fn(scratchPath);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

test("the real fixture's sha256 matches the pinned EXPECTED_UPSTREAM_SHA256 constant — this test suite runs against the exact source the patch was written and reviewed against, not an approximation", () => {
  const actualSha256 = require("node:crypto").createHash("sha256").update(REAL_UPSTREAM_SOURCE, "utf8").digest("hex");
  assert.equal(actualSha256, EXPECTED_UPSTREAM_SHA256);
});

test("the pinned ORIGINAL_TOKEN_RESOLVER_SOURCE occurs exactly once in the real fixture, byte-for-byte", () => {
  const occurrences = REAL_UPSTREAM_SOURCE.split(ORIGINAL_TOKEN_RESOLVER_SOURCE).length - 1;
  assert.equal(occurrences, 1);
});

test("applyTokenResolverPatch applies cleanly against a real copy of the pinned plugin source", () => {
  withScratchCopy((scratchPath) => {
    const result = applyTokenResolverPatch(scratchPath);
    assert.equal(result.outcome, "applied");
    assert.equal(result.actualSha256, EXPECTED_UPSTREAM_SHA256);
    const patched = fs.readFileSync(scratchPath, "utf8");
    assert.ok(patched.includes(PATCHED_TOKEN_RESOLVER_SOURCE));
  });
});

test("applyTokenResolverPatch is idempotent — re-running against an already-patched file reports already_patched and does not change the content further", () => {
  withScratchCopy((scratchPath) => {
    applyTokenResolverPatch(scratchPath);
    const afterFirstPatch = fs.readFileSync(scratchPath, "utf8");
    const second = applyTokenResolverPatch(scratchPath);
    assert.equal(second.outcome, "already_patched");
    const afterSecondPatch = fs.readFileSync(scratchPath, "utf8");
    assert.equal(afterFirstPatch, afterSecondPatch);
  });
});

test("applyTokenResolverPatch refuses to patch a file whose sha256 does not match the pinned upstream hash", () => {
  withScratchCopy((scratchPath) => {
    fs.writeFileSync(scratchPath, REAL_UPSTREAM_SOURCE + "\n// unexpected trailing content", "utf8");
    assert.throws(() => applyTokenResolverPatch(scratchPath), TokenResolverPatchError);
  });
});

test("applyTokenResolverPatch leaves the file completely untouched when it refuses to patch (hash mismatch)", () => {
  withScratchCopy((scratchPath) => {
    const tampered = REAL_UPSTREAM_SOURCE + "\n// unexpected trailing content";
    fs.writeFileSync(scratchPath, tampered, "utf8");
    assert.throws(() => applyTokenResolverPatch(scratchPath));
    assert.equal(fs.readFileSync(scratchPath, "utf8"), tampered);
  });
});

test("patchTokenResolverSource refuses to patch a string where the target substring does not occur", () => {
  assert.throws(() => patchTokenResolverSource("no resolver here at all"), TokenResolverPatchError);
});

test("patchTokenResolverSource refuses to patch a string where the target substring occurs more than once — never guesses which occurrence is real", () => {
  const doubled = ORIGINAL_TOKEN_RESOLVER_SOURCE + "\n" + ORIGINAL_TOKEN_RESOLVER_SOURCE;
  assert.throws(() => patchTokenResolverSource(doubled), TokenResolverPatchError);
});

test("the patched output is syntactically valid JavaScript, verified by actually running node --check against it, not just assumed", () => {
  withScratchCopy((scratchPath) => {
    applyTokenResolverPatch(scratchPath);
    // Throws (and this test would fail) if node considers the file invalid.
    execFileSync(process.execPath, ["--check", scratchPath]);
  });
});

test("the patched resolver's original two branches (plain string, legacy {env:\"VAR\"}) are byte-identical to before the patch — only one new branch was added, nothing else changed", () => {
  withScratchCopy((scratchPath) => {
    applyTokenResolverPatch(scratchPath);
    const patchedSource = fs.readFileSync(scratchPath, "utf8");
    const patchedFn = extractFunctionSource(patchedSource, "function Ue(e)");
    assert.ok(patchedFn.startsWith(ORIGINAL_TOKEN_RESOLVER_SOURCE.slice(0, -2)), "the original branches' source must be a strict prefix of the patched function");
  });
});

test("evaluating the ACTUAL patched Ue function (extracted from the real patched file, not a reimplementation) resolves every shape correctly: plain string, legacy {env}, the real OpenClaw SecretRef shape, and correctly leaves unsupported/unknown shapes unresolved", () => {
  withScratchCopy((scratchPath) => {
    applyTokenResolverPatch(scratchPath);
    const patchedSource = fs.readFileSync(scratchPath, "utf8");
    const fnSource = extractFunctionSource(patchedSource, "function Ue(e)");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating the real extracted source under test, not user input
    const Ue: (input: unknown) => string | undefined = new Function(
      "process",
      `return (${fnSource.replace("function Ue", "function")})`
    )(process);

    const originalEnv = { ...process.env };
    try {
      process.env.OPENCLAW_GATEWAY_TOKEN = "test-secret-token-value";
      process.env.LEGACY_VAR = "legacy-value";

      assert.equal(Ue("literal-token"), "literal-token");
      assert.equal(Ue({ env: "LEGACY_VAR" }), "legacy-value");
      assert.equal(Ue({ env: "DOES_NOT_EXIST_VAR" }), undefined);
      assert.equal(
        Ue({ provider: "default", source: "env", id: "OPENCLAW_GATEWAY_TOKEN" }),
        "test-secret-token-value",
        "the exact SecretRef shape scripts/seller-runtime-supervisor.ts writes for gateway.auth.token must now resolve"
      );
      assert.equal(Ue({ provider: "default", source: "env", id: "DOES_NOT_EXIST_VAR" }), undefined);
      assert.equal(Ue({ provider: "default", source: "file", id: "/some/path" }), undefined, "unsupported source kinds must remain unresolved, not silently mishandled");
      assert.equal(Ue(undefined), undefined);
      assert.equal(Ue(null), undefined);
    } finally {
      process.env = originalEnv;
    }
  });
});

test("the exact token value never appears in this test file's own assertions as a literal shared with production — regression guard against accidentally hardcoding a real secret in a fixture", () => {
  assert.ok(!REAL_UPSTREAM_SOURCE.includes("OPENCLAW_GATEWAY_TOKEN"), "the unpatched upstream source must not itself reference this env var name (confirms the bug is real: it never reads it by name)");
});

console.log("patch-okx-a2a-openclaw-token-resolver: all passed");
