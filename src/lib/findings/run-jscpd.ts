import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { JscpdRawReport } from "./types";
import { TOOL_TIMEOUT_MS } from "./types";

export interface JscpdRunResult {
  available: boolean;
  report: JscpdRawReport | null;
  error?: string;
}

export async function runJscpd(rootDir: string): Promise<JscpdRunResult> {
  const outDir = path.join(rootDir, ".repodiet-jscpd");
  await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});

  try {
    const result = await execa(
      "npx",
      [
        "jscpd",
        "--pattern",
        "**/*.{js,ts,tsx,jsx,mjs,cjs}",
        "--ignore",
        "**/node_modules/**,**/.next/**,**/dist/**,**/build/**,**/coverage/**,**/.cache/**,**/.repodiet-jscpd/**",
        "--min-lines",
        "4",
        "--min-tokens",
        "35",
        "--reporters",
        "json",
        "--output",
        outDir,
        "--absolute",
        rootDir,
      ],
      {
        cwd: rootDir,
        timeout: TOOL_TIMEOUT_MS,
        reject: false,
        env: { ...process.env, FORCE_COLOR: "0" },
      }
    );

    const reportPath = path.join(outDir, "jscpd-report.json");
    let raw: string;
    try {
      raw = await fs.readFile(reportPath, "utf8");
    } catch {
      return {
        available: false,
        report: null,
        error: result.stderr || "jscpd report not found.",
      };
    }

    const report = JSON.parse(raw) as JscpdRawReport;
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    return { available: true, report };
  } catch (err) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    return {
      available: false,
      report: null,
      error: err instanceof Error ? err.message : "jscpd failed.",
    };
  }
}
