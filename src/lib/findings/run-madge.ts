import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { MadgeRawReport } from "./types";
import { TOOL_TIMEOUT_MS } from "./types";

export interface MadgeRunResult {
  available: boolean;
  report: MadgeRawReport | null;
  error?: string;
}

async function resolveEntry(rootDir: string): Promise<string> {
  const candidates = [
    "src/index.ts",
    "src/index.tsx",
    "src/main.ts",
    "index.ts",
    "index.js",
    "app/page.tsx",
    "pages/index.tsx",
  ];
  for (const c of candidates) {
    try {
      await fs.access(path.join(rootDir, c));
      return path.join(rootDir, c);
    } catch {
      /* next */
    }
  }
  return rootDir;
}

export async function runMadge(rootDir: string): Promise<MadgeRunResult> {
  const scriptPath = path.join(process.cwd(), "scripts/madge-scan.mjs");
  const entry = await resolveEntry(rootDir);

  try {
    const result = await execa("node", [scriptPath, rootDir, entry], {
      timeout: TOOL_TIMEOUT_MS,
      reject: false,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    if (result.exitCode !== 0) {
      let errMsg = result.stderr || "Madge failed.";
      try {
        const parsed = JSON.parse(result.stderr);
        if (parsed.error) errMsg = parsed.error;
      } catch {
        /* use stderr */
      }
      return { available: false, report: null, error: errMsg };
    }

    const report = JSON.parse(result.stdout) as MadgeRawReport;
    return { available: true, report };
  } catch (err) {
    return {
      available: false,
      report: null,
      error: err instanceof Error ? err.message : "Madge failed.",
    };
  }
}
