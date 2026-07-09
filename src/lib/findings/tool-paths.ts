import path from "node:path";

export function knipCliPath(): string {
  return path.join(process.cwd(), "node_modules", "knip", "bin", "knip.js");
}

export function jscpdCliPath(): string {
  return path.join(process.cwd(), "node_modules", "jscpd", "run-jscpd.js");
}

export function madgeScriptPath(): string {
  return path.join(process.cwd(), "scripts", "madge-scan.mjs");
}
