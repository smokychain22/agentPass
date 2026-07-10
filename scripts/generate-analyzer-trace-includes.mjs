#!/usr/bin/env node
/**
 * Regenerate analyzer-trace-includes.json for Vercel outputFileTracingIncludes.
 * Walks node_modules from the repo root so Knip/Madge transitive deps are bundled.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(ROOT, "node_modules");

function pkgJsonPath(name) {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return path.join(NODE_MODULES, scope, pkg, "package.json");
  }
  return path.join(NODE_MODULES, name, "package.json");
}

function collectDeps(pkgName, seen = new Set(), depth = 0) {
  if (seen.has(pkgName) || depth > 10) return seen;
  seen.add(pkgName);

  const pkgJson = pkgJsonPath(pkgName);
  if (!fs.existsSync(pkgJson)) return seen;

  const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
  const deps = {
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  for (const dep of Object.keys(deps || {})) collectDeps(dep, seen, depth + 1);
  return seen;
}

const roots = ["knip", "madge", "jscpd", "formatly", "commander", "formdata-node", "execa"];
const all = new Set();
for (const root of roots) {
  for (const dep of collectDeps(root)) all.add(dep);
}

const includes = [...all]
  .sort()
  .map((pkg) => {
    if (pkg.startsWith("@")) return `./node_modules/${pkg}/**/*`;
    return `./node_modules/${pkg}/**/*`;
  });

const outPath = path.join(ROOT, "analyzer-trace-includes.json");
fs.writeFileSync(outPath, `${JSON.stringify(includes, null, 2)}\n`);
console.log(`Wrote ${includes.length} trace includes to ${outPath}`);
