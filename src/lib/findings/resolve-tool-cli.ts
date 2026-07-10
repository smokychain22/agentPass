import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function exists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function packageRoot(packageName: string): string | null {
  try {
    const pkgJson = require.resolve(`${packageName}/package.json`);
    return path.dirname(pkgJson);
  } catch {
    return null;
  }
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
