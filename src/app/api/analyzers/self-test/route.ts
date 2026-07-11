import { NextResponse } from "next/server";
import { runKnip } from "@/lib/findings/run-knip";
import { runMadge } from "@/lib/findings/run-madge";
import { runJscpd } from "@/lib/findings/run-jscpd";
import { probeAnalyzerTooling } from "@/lib/findings/resolve-tool-cli";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";
import path from "node:path";
import fs from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const modules = probeAnalyzerTooling();

  const workspace = await createScanWorkspace("analyzer-self-test");
  const rootDir = workspace.extractPath;

  try {
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({ name: "analyzer-self-test", private: true, version: "0.0.0" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(rootDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "bundler" } }),
      "utf8"
    );
    await fs.writeFile(
      path.join(rootDir, "index.ts"),
      'import type { Foo } from "./types";\nexport const x: Foo = 1;\n',
      "utf8"
    );
    await fs.writeFile(path.join(rootDir, "types.ts"), "export type Foo = number;\n", "utf8");

    const [knip, madge, jscpd] = await Promise.all([
      runKnip(rootDir),
      runMadge(rootDir),
      runJscpd(rootDir),
    ]);

    const durationMs = Date.now() - started;
    const allModulesResolved = modules.every((m) => m.resolved);
    const analyzersHealthy =
      knip.status !== "failed" &&
      madge.status !== "failed" &&
      jscpd.status !== "failed";
    const analyzersNative =
      knip.status === "ok" &&
      madge.status === "ok" &&
      jscpd.status === "ok";

    const status =
      allModulesResolved && analyzersHealthy && analyzersNative ? "passed" : "failed";

    return NextResponse.json(
      {
        status,
        durationMs,
        modules,
        analyzers: {
          knip: {
            status: knip.status,
            sourceMode: knip.sourceMode,
            durationMs: knip.durationMs,
            error: knip.error,
          },
          madge: {
            status: madge.status,
            sourceMode: madge.sourceMode,
            durationMs: madge.durationMs,
            error: madge.error,
          },
          jscpd: {
            status: jscpd.status,
            sourceMode: jscpd.sourceMode,
            durationMs: jscpd.durationMs,
            error: jscpd.error,
          },
        },
      },
      { status: status === "passed" ? 200 : 503 }
    );
  } finally {
    await removeWorkspace(workspace.root).catch(() => {});
  }
}
