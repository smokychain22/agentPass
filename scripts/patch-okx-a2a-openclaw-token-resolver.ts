#!/usr/bin/env tsx
/**
 * Build-time compatibility patch: teaches the pinned
 * @okxweb3/a2a-openclaw@0.2.0 plugin's own internal Gateway token
 * resolver to understand OpenClaw core's SecretRef shape.
 *
 * === Root cause, confirmed by direct source reading (not assumed) ===
 * The plugin's manifest (openclaw-plugins/okx-a2a-openclaw/openclaw.plugin.json
 * once extracted, or `node_modules @okxweb3/a2a-openclaw` locally) declares
 * an EMPTY configSchema (`"properties": {}`) — it has no plugin-specific
 * config surface at all. Its own dist/index.js always reads the token from
 * the SAME shared `gateway.auth.token` field this supervisor configures,
 * through its own resolver:
 *
 *   function en(e){if(e){if(typeof e=="string")return e;if(typeof e=="object"
 *   &&e!==null&&"env"in e)return process.env[e.env]||void 0}}
 *
 * `en` only understands a plain string or the plugin-native `{env:
 * "VARNAME"}` shorthand — never the `{provider, source, id}` SecretRef
 * shape OpenClaw core actually uses (verified against
 * openclaw/dist/plugin-sdk/secret-ref-runtime.js's own resolution: a ref
 * with `source==="env"` resolves by reading `process.env[ref.id]`).
 * scripts/seller-runtime-supervisor.ts's buildOpenclawConfigBatch() sets
 * `gateway.auth.token` to exactly `{provider:"default", source:"env",
 * id:"OPENCLAW_GATEWAY_TOKEN"}` — an object with no `env` key — so `en`
 * silently returns `undefined` for it. This is NOT a config bug on the
 * supervisor's side: this IS the OpenClaw-documented SecretRef shape, and
 * the Gateway's own core auth resolution reads it correctly; only this
 * one third-party plugin's own internal (unrelated, separate) Gateway
 * client fails to. There is no plugin-specific field to redirect this
 * through instead — confirmed by reading the plugin's entire dist/index.js
 * end to end (80,682 bytes): no reference to any plugin-scoped config key,
 * `OPENCLAW_GATEWAY_TOKEN`, or `OKX_A2A_OPENCLAW_GATEWAY_TOKEN` exists in
 * it at all, and its manifest configSchema is still `"properties": {}`.
 *
 * Identical bug across every version this project has pinned. Each re-minify
 * has only renamed the function — `Ue` in 0.1.10, `ze` in 0.1.11, `en` in
 * 0.2.0 — while the body stayed byte-identical. Re-verified against 0.2.0 on
 * 2026-08-07, when the pin was moved off 0.1.11 (see Incident #17 in
 * gate-check-proof.ts): the upstream defect is still present, still occurs
 * exactly once, and the plugin still exposes no config surface to route
 * around it. A version bump alone has never fixed this, and this patch is
 * re-verified — never blindly re-applied — on every bump, as designed.
 *
 * === The patch ===
 * A single, narrow, additive branch: when `en` receives an object with
 * `source === "env"` and a string `id` (i.e. exactly the shape a
 * `source:"env"` SecretRef takes), it now also resolves
 * `process.env[e.id]` — mirroring OpenClaw core's own env-source
 * resolution semantics exactly, not inventing a new one. The two
 * pre-existing branches (`string`, `{env:"X"}`) are untouched.
 *
 * === Safety ===
 * This patch refuses to run — failing the Docker build — unless the
 * target file's SHA-256 matches exactly what this patch was written and
 * reviewed against, and unless the known original resolver source occurs
 * exactly once. A version bump of @okxweb3/a2a-openclaw that changes this
 * function (even by variable renaming under a re-minify) must be caught
 * and re-reviewed, never silently re-applied to different code.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** The minified name of the resolver in the pinned version. Renamed by every upstream re-minify, so it is a constant here rather than inlined in three places. */
export const TOKEN_RESOLVER_FUNCTION_NAME = "en";

/** Pinned against @okxweb3/a2a-openclaw@0.2.0's real published dist/index.js — computed directly from the exact tarball Dockerfile.seller extracts (same npm pack + integrity-checked source), not guessed. */
export const EXPECTED_UPSTREAM_SHA256 =
  "f1ca17d8330d247ad6ed05f087ee7b79b1e63a78612841c407b7c393769460da";

/**
 * Exact byte-for-byte source of the unpatched resolver, extracted via
 * brace-depth counting from the real pinned file (not hand-transcribed).
 */
export const ORIGINAL_TOKEN_RESOLVER_SOURCE =
  `function ${TOKEN_RESOLVER_FUNCTION_NAME}(e){if(e){if(typeof e=="string")return e;if(typeof e=="object"&&e!==null&&"env"in e)return process.env[e.env]||void 0}}`;

/** Adds exactly one new branch; the two original branches are byte-identical to before. */
export const PATCHED_TOKEN_RESOLVER_SOURCE =
  `function ${TOKEN_RESOLVER_FUNCTION_NAME}(e){if(e){if(typeof e=="string")return e;if(typeof e=="object"&&e!==null&&"env"in e)return process.env[e.env]||void 0;if(typeof e=="object"&&e!==null&&e.source==="env"&&typeof e.id=="string")return process.env[e.id]||void 0}}`;

export type PatchOutcome = "applied" | "already_patched";

export interface PatchResult {
  outcome: PatchOutcome;
  actualSha256: string;
}

export class TokenResolverPatchError extends Error {}

/**
 * Pure string transform, independent of any file I/O — this is the part
 * that actually decides whether a source string is safe to patch and
 * performs the substitution. Separated from `applyTokenResolverPatch` so
 * both the "is this exact substring present exactly once" guard and the
 * substitution itself can be tested directly against crafted strings,
 * independent of the whole-file hash check (which, by construction, can
 * never itself be exercised with a mismatched occurrence count — any
 * change to the file content changes its hash).
 */
export function patchTokenResolverSource(source: string): string {
  const occurrences = source.split(ORIGINAL_TOKEN_RESOLVER_SOURCE).length - 1;
  if (occurrences !== 1) {
    throw new TokenResolverPatchError(
      `refusing to patch: expected exactly one occurrence of the known token-resolver source, found ${occurrences}.`
    );
  }
  return source.replace(ORIGINAL_TOKEN_RESOLVER_SOURCE, PATCHED_TOKEN_RESOLVER_SOURCE);
}

/**
 * Idempotent: if the file already contains the patched source (e.g. this
 * script runs twice), it is left unchanged and reported as
 * "already_patched" rather than double-patching or failing.
 */
export function applyTokenResolverPatch(pluginDistIndexPath: string): PatchResult {
  const original = readFileSync(pluginDistIndexPath, "utf8");

  if (original.includes(PATCHED_TOKEN_RESOLVER_SOURCE)) {
    return { outcome: "already_patched", actualSha256: createHash("sha256").update(original, "utf8").digest("hex") };
  }

  const actualSha256 = createHash("sha256").update(original, "utf8").digest("hex");
  if (actualSha256 !== EXPECTED_UPSTREAM_SHA256) {
    throw new TokenResolverPatchError(
      `refusing to patch ${pluginDistIndexPath}: sha256 is ${actualSha256}, expected ${EXPECTED_UPSTREAM_SHA256} ` +
        `(pinned from @okxweb3/a2a-openclaw@0.2.0's real published dist/index.js). The upstream source no longer ` +
        `matches what this patch was written and reviewed against — a version bump or repackage must be re-reviewed ` +
        `before this patch is safe to reapply; refusing to guess.`
    );
  }

  const patched = patchTokenResolverSource(original);
  writeFileSync(pluginDistIndexPath, patched, "utf8");
  return { outcome: "applied", actualSha256 };
}

function main(): void {
  const pluginDistIndexPath = process.argv[2];
  if (!pluginDistIndexPath) {
    console.error("[patch-okx-a2a-openclaw-token-resolver] FAILED: usage: patch-okx-a2a-openclaw-token-resolver.ts <path-to-dist/index.js>");
    process.exit(1);
  }
  try {
    const result = applyTokenResolverPatch(pluginDistIndexPath);
    console.log(
      `[patch-okx-a2a-openclaw-token-resolver] OK: ${result.outcome} (sha256 ${result.actualSha256}) at ${pluginDistIndexPath}`
    );
  } catch (err) {
    console.error(`[patch-okx-a2a-openclaw-token-resolver] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
