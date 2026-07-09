import path from "node:path";
import { execa } from "execa";
import type { KnipRawReport } from "./types";
import { TOOL_TIMEOUT_MS } from "./types";

export interface KnipRunResult {
  available: boolean;
  report: KnipRawReport | null;
  error?: string;
}

export async function runKnip(rootDir: string): Promise<KnipRunResult> {
  const pkgPath = path.join(rootDir, "package.json");
  try {
    await import("node:fs/promises").then((fs) => fs.access(pkgPath));
  } catch {
    return { available: false, report: null, error: "No package.json — Knip skipped." };
  }

  try {
    const result = await execa("npx", ["knip", "--reporter", "json", "--no-progress"], {
      cwd: rootDir,
      timeout: TOOL_TIMEOUT_MS,
      reject: false,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    if (!result.stdout?.trim()) {
      return { available: false, report: null, error: result.stderr || "Knip produced no output." };
    }

    const report = JSON.parse(result.stdout) as KnipRawReport;
    return { available: true, report };
  } catch (err) {
    return {
      available: false,
      report: null,
      error: err instanceof Error ? err.message : "Knip failed.",
    };
  }
}
