import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

function projectRequire() {
  const pkgJson = path.join(process.cwd(), "package.json");
  try {
    return createRequire(pkgJson);
  } catch {
    return createRequire(import.meta.url);
  }
}

function packageDir(packageName: string): string | null {
  const segments = packageName.startsWith("@")
    ? packageName.split("/")
    : [packageName];
  const dir = path.join(process.cwd(), "node_modules", ...segments);
  return exists(path.join(dir, "package.json")) ? dir : null;
}

function exists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function packageRoot(packageName: string): string | null {
  const fromFs = packageDir(packageName);
  if (fromFs) return fromFs;
  try {
    const pkgJson = projectRequire().resolve(`${packageName}/package.json`);
    return path.dirname(pkgJson);
  } catch {
    return null;
  }
}

export interface ModuleProbe {
  name: string;
  resolved: boolean;
  version?: string;
  error?: string;
}

export function probePackage(name: string): ModuleProbe {
  const dir = packageDir(name);
  if (!dir) {
    return { name, resolved: false, error: `${name} not found under node_modules` };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      version?: string;
    };
    return { name, resolved: true, version: pkg.version };
  } catch (err) {
    return {
      name,
      resolved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function probeAnalyzerTooling(): ModuleProbe[] {
  const probes: ModuleProbe[] = [
    probePackage("commander"),
    probePackage("formdata-node"),
    probePackage("knip"),
    probePackage("madge"),
    probePackage("jscpd"),
    probePackage("fd-package-json"),
    probePackage("walkdir"),
  ];

  const knip = resolveKnipCli();
  probes.push({
    name: "knip-cli",
    resolved: !!knip,
    version: knip?.version,
    error: knip ? undefined : "Knip CLI path not found",
  });

  const jscpd = resolveJscpdCli();
  probes.push({
    name: "jscpd-cli",
    resolved: !!jscpd,
    version: jscpd?.version,
    error: jscpd ? undefined : "jscpd CLI path not found",
  });

  const madge = resolveMadgeEntry();
  probes.push({
    name: "madge-script",
    resolved: !!madge,
    version: madge?.version,
    error: madge ? undefined : "madge-scan.mjs not found",
  });

  return probes;
}

export function resolveKnipCli(): { path: string; version?: string } | null {
  const candidates: string[] = [];
  const root = packageRoot("knip");
  if (root) {
    candidates.push(
      path.join(root, "bin", "knip.js"),
      path.join(root, "bin", "knip-bun.js"),
      path.join(root, "dist", "cli.js")
    );
  }
  candidates.push(path.join(process.cwd(), "node_modules", "knip", "bin", "knip.js"));

  for (const cli of candidates) {
    if (exists(cli)) {
      const version = root
        ? (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string })
            .version
        : undefined;
      return { path: cli, version };
    }
  }
  return null;
}

export function resolveJscpdCli(): { path: string; version?: string } | null {
  const candidates: string[] = [];
  const root = packageRoot("jscpd");
  if (root) {
    candidates.push(
      path.join(root, "run-jscpd.js"),
      path.join(root, "bin", "jscpd.js"),
      path.join(root, "dist", "cli.js")
    );
  }
  candidates.push(path.join(process.cwd(), "node_modules", "jscpd", "run-jscpd.js"));

  for (const cli of candidates) {
    if (exists(cli)) {
      const version = root
        ? (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string })
            .version
        : undefined;
      return { path: cli, version };
    }
  }
  return null;
}

export function resolveMadgeEntry(): { scriptPath: string; version?: string } | null {
  const scriptPath = path.join(process.cwd(), "scripts", "madge-scan.mjs");
  if (exists(scriptPath)) {
    const root = packageRoot("madge");
    const version = root
      ? (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string })
          .version
      : undefined;
    return { scriptPath, version };
  }
  return null;
}
