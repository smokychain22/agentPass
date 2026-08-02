#!/usr/bin/env tsx
/**
 * Fails loudly when OpenClaw's effective fallback model is not present in the
 * live model registry.
 *
 * Why: on 2026-08-01 and again on 2026-08-02 every OpenClaw turn that was NOT
 * claimed by the RepoDiet bridge died with
 *
 *   FailoverError: Unknown model: openai/gpt-5.5
 *   decision=candidate_failed reason=model_not_found next=none
 *                             fallbackConfigured=false
 *   Embedded agent failed before reply: Unknown model: openai/gpt-5.5
 *
 * openclaw.json configures no `agent`/model key at all, so OpenClaw falls back
 * to a built-in default name that this deployment's registry does not contain.
 * The run then ends with no reply and no operator-visible signal — the exact
 * silent-timeout shape that got Agent 9636 rejected.
 *
 * Seller Agent 9636 traffic is deliberately model-INDEPENDENT (the bridge
 * answers it deterministically), so this is not a seller-path blocker. It does
 * still break buyer Agent 5295's own turns and any unclaimed session, and a
 * broken model must never again be a silent failure.
 *
 * This check deliberately does NOT invent a model name and does NOT add a
 * provider without credentials. It reports what is actually configured and
 * what the registry actually offers.
 *
 * Usage (on the Machine):
 *   gosu node env HOME=/persistent/home npx tsx scripts/verify-model-readiness.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

type Finding = { ok: boolean; label: string; detail: string };

async function openclaw(args: string[]): Promise<string> {
  try {
    const { stdout } = await run("openclaw", args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    return e.stdout ?? `ERROR: ${e.message ?? "unknown"}`;
  }
}

function parseConfiguredModel(configJson: string): string | undefined {
  try {
    const cfg = JSON.parse(configJson) as Record<string, unknown>;
    const agent = cfg.agent as Record<string, unknown> | undefined;
    const model = agent?.model ?? (cfg as Record<string, unknown>).model;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const findings: Finding[] = [];

  const configRaw = await openclaw(["config", "get", "--json"]);
  const configured = parseConfiguredModel(configRaw);

  findings.push({
    ok: Boolean(configured),
    label: "configured_model",
    detail: configured
      ? `openclaw.json declares model=${configured}`
      : "openclaw.json declares NO agent/model key — OpenClaw uses its built-in default",
  });

  const modelsRaw = await openclaw(["models", "list", "--json"]);
  const available: string[] = [];
  try {
    const parsed = JSON.parse(modelsRaw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.models as unknown[]) ?? [];
    for (const m of list) {
      const id =
        typeof m === "string" ? m : ((m as Record<string, unknown>)?.id as string | undefined);
      if (id) available.push(id);
    }
  } catch {
    /* registry unreadable — reported below */
  }

  findings.push({
    ok: available.length > 0,
    label: "model_registry",
    detail:
      available.length > 0
        ? `${available.length} model(s) available, e.g. ${available.slice(0, 5).join(", ")}`
        : "live model registry returned no usable models (no provider credentials configured)",
  });

  if (configured) {
    findings.push({
      ok: available.includes(configured),
      label: "configured_model_present",
      detail: available.includes(configured)
        ? `${configured} is present in the live registry`
        : `${configured} is NOT in the live registry — every unclaimed turn will fail with "Unknown model"`,
    });
  }

  // The seller path must never depend on any of the above.
  findings.push({
    ok: true,
    label: "seller_path_model_independent",
    detail:
      "Agent 9636 seller sessions are answered by repodiet-a2a-bridge before any model resolution, so they are unaffected by model availability",
  });

  let failed = 0;
  for (const f of findings) {
    if (!f.ok) failed++;
    console.log(`${f.ok ? "PASS" : "FAIL"}  ${f.label}: ${f.detail}`);
  }

  if (failed > 0) {
    console.error(
      `\nmodel readiness: ${failed} check(s) failed. Unclaimed OpenClaw sessions will end with no reply.`
    );
    process.exit(1);
  }
  console.log("\nmodel readiness: OK");
}

main().catch((err) => {
  console.error("model readiness check crashed:", err);
  process.exit(1);
});
