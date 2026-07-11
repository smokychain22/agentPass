import path from "node:path";
import { resolveKnipCli, resolveJscpdCli, resolveMadgeEntry } from "./resolve-tool-cli";

export function knipCliPath(): string {
  return resolveKnipCli()?.path ?? path.join(process.cwd(), "node_modules", "knip", "bin", "knip.js");
}

export function jscpdCliPath(): string {
  return resolveJscpdCli()?.path ?? path.join(process.cwd(), "node_modules", "jscpd", "run-jscpd.js");
}

export function madgeScriptPath(): string {
  return resolveMadgeEntry()?.scriptPath ?? path.join(process.cwd(), "scripts", "madge-scan.mjs");
}

export function knipVersion(): string | undefined {
  return resolveKnipCli()?.version;
}

export function jscpdVersion(): string | undefined {
  return resolveJscpdCli()?.version;
}

export function madgeVersion(): string | undefined {
  return resolveMadgeEntry()?.version;
}
