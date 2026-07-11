import fs from "node:fs/promises";
import path from "node:path";
import type { FrameworkDetection, FrameworkName } from "./types";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(rootDir: string): Promise<PackageJson | null> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(rootDir: string, name: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(rootDir, name));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function hasConfig(rootDir: string, pattern: RegExp): Promise<string | null> {
  try {
    const entries = await fs.readdir(rootDir);
    const match = entries.find((e) => pattern.test(e));
    return match ?? null;
  } catch {
    return null;
  }
}

function hasDep(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

export async function detectFramework(rootDir: string): Promise<FrameworkDetection> {
  const pkg = await readPackageJson(rootDir);
  const signals: string[] = [];
  const scores: Partial<Record<FrameworkName, number>> = {};

  const nextConfig = await hasConfig(rootDir, /^next\.config\.(js|mjs|ts|cjs)$/);
  if (nextConfig) {
    signals.push(nextConfig);
    scores["Next.js"] = (scores["Next.js"] ?? 0) + 0.35;
  }
  if (hasDep(pkg, "next")) {
    signals.push("next dependency");
    scores["Next.js"] = (scores["Next.js"] ?? 0) + 0.35;
  }
  if (await dirExists(rootDir, "app")) {
    signals.push("app/ directory");
    scores["Next.js"] = (scores["Next.js"] ?? 0) + 0.2;
  }
  if (await dirExists(rootDir, "pages")) {
    signals.push("pages/ directory");
    scores["Next.js"] = (scores["Next.js"] ?? 0) + 0.15;
  }

  const viteConfig = await hasConfig(rootDir, /^vite\.config\.(js|ts|mjs|cjs)$/);
  if (viteConfig) {
    signals.push(viteConfig);
    scores["Vite"] = (scores["Vite"] ?? 0) + 0.5;
  }
  if (hasDep(pkg, "vite")) {
    signals.push("vite dependency");
    scores["Vite"] = (scores["Vite"] ?? 0) + 0.35;
  }

  if (await pathExists(path.join(rootDir, "remix.config.js"))) {
    signals.push("remix.config.js");
    scores["Remix"] = (scores["Remix"] ?? 0) + 0.55;
  }
  if (hasDep(pkg, "@remix-run/react")) {
    signals.push("@remix-run/react dependency");
    scores["Remix"] = (scores["Remix"] ?? 0) + 0.35;
  }

  const astroConfig = await hasConfig(rootDir, /^astro\.config\.(mjs|js|ts|cjs)$/);
  if (astroConfig) {
    signals.push(astroConfig);
    scores["Astro"] = (scores["Astro"] ?? 0) + 0.55;
  }
  if (hasDep(pkg, "astro")) {
    signals.push("astro dependency");
    scores["Astro"] = (scores["Astro"] ?? 0) + 0.35;
  }

  if (hasDep(pkg, "express")) {
    signals.push("express dependency");
    scores["Node/Express"] = (scores["Node/Express"] ?? 0) + 0.5;
  }

  if (hasDep(pkg, "react") && !scores["Next.js"] && !scores["Remix"]) {
    signals.push("react dependency");
    scores["React"] = (scores["React"] ?? 0) + 0.45;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as [
    FrameworkName,
    number,
  ][];

  if (ranked.length === 0) {
    const hasJsTs = signals.length === 0;
    if (pkg) signals.push("package.json present");
    return {
      name: "Unknown JS/TS",
      confidence: hasJsTs ? 0.4 : 0.55,
      signals: signals.length ? signals : ["No dominant framework signals"],
    };
  }

  const [name, rawScore] = ranked[0];
  const confidence = Math.min(0.99, Math.round(rawScore * 100) / 100 + 0.35);

  return {
    name,
    confidence: Math.min(0.99, Math.round(confidence * 100) / 100),
    signals: [...new Set(signals)].slice(0, 6),
  };
}
