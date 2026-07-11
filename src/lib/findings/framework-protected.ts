/** Framework and tooling paths/deps that must not be flagged as unused by fallback analyzers. */

import type { FrameworkName } from "@/lib/scanner/types";

const FRAMEWORK_FILE_PATTERNS: RegExp[] = [
  /(^|\/)eslint\.config\.(mjs|cjs|js|ts)$/,
  /(^|\/)postcss\.config\.(mjs|cjs|js|ts)$/,
  /(^|\/)tailwind\.config\.(mjs|cjs|js|ts)$/,
  /(^|\/)next\.config\.(mjs|cjs|js|ts)$/,
  /(^|\/)src\/app\/global-error\.(tsx?|jsx?)$/,
  /(^|\/)app\/global-error\.(tsx?|jsx?)$/,
  /(^|\/)src\/app\/not-found\.(tsx?|jsx?)$/,
  /(^|\/)app\/not-found\.(tsx?|jsx?)$/,
  /(^|\/)src\/app\/loading\.(tsx?|jsx?)$/,
  /(^|\/)app\/loading\.(tsx?|jsx?)$/,
  /(^|\/)src\/app\/error\.(tsx?|jsx?)$/,
  /(^|\/)app\/error\.(tsx?|jsx?)$/,
  /(^|\/)src\/app\/template\.(tsx?|jsx?)$/,
  /(^|\/)app\/template\.(tsx?|jsx?)$/,
  /(^|\/)src\/app\/default\.(tsx?|jsx?)$/,
  /(^|\/)app\/default\.(tsx?|jsx?)$/,
  /(^|\/)instrumentation\.(ts|js)$/,
];

const TOOLING_DEPENDENCIES = new Set([
  "typescript",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "eslint",
  "eslint-config-next",
  "tailwindcss",
  "@tailwindcss/postcss",
  "postcss",
  "autoprefixer",
  "prettier",
  "next",
  "react",
  "react-dom",
]);

export function isFrameworkProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return FRAMEWORK_FILE_PATTERNS.some((p) => p.test(normalized));
}

export function isToolingDependency(packageName: string): boolean {
  return TOOLING_DEPENDENCIES.has(packageName);
}

export function isConfigReferencedDependency(
  packageName: string,
  packageJson: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }
): boolean {
  if (isToolingDependency(packageName)) return true;
  const scripts = Object.values(packageJson.scripts ?? {}).join(" ");
  if (scripts.includes(packageName)) return true;
  return false;
}

export type FrameworkDependencySection = "runtime" | "typescript_tooling" | "config";

export interface FrameworkDependencyPolicyEntry {
  packageName: string;
  section: FrameworkDependencySection;
  reason: string;
}

const NEXT_JS_RUNTIME = ["next", "react", "react-dom"] as const;
const NEXT_JS_TYPESCRIPT = [
  "typescript",
  "@types/node",
  "@types/react",
  "@types/react-dom",
] as const;

/** Knip/import-graph evidence is not deletion authorization — framework policy protects required deps. */
export function getFrameworkProtectedDependencies(
  framework: FrameworkName | string | undefined,
  options?: { hasTypeScriptFiles?: boolean }
): FrameworkDependencyPolicyEntry[] {
  const normalized = String(framework ?? "").toLowerCase();
  const isNext = normalized.includes("next");
  if (!isNext) return [];

  const entries: FrameworkDependencyPolicyEntry[] = NEXT_JS_RUNTIME.map((packageName) => ({
    packageName,
    section: "runtime",
    reason: "Next.js requires next, react, and react-dom in dependencies.",
  }));

  if (options?.hasTypeScriptFiles !== false) {
    for (const packageName of NEXT_JS_TYPESCRIPT) {
      entries.push({
        packageName,
        section: "typescript_tooling",
        reason: "TypeScript Next.js projects require framework type packages.",
      });
    }
  }

  return entries;
}

export function isFrameworkProtectedDependency(
  packageName: string,
  framework: FrameworkName | string | undefined,
  options?: { hasTypeScriptFiles?: boolean }
): boolean {
  return getFrameworkProtectedDependencies(framework, options).some(
    (entry) => entry.packageName === packageName
  );
}

export function filterProtectedUnusedDependencies<T extends { packageName?: string }>(
  findings: T[],
  framework: FrameworkName | string | undefined,
  options?: { hasTypeScriptFiles?: boolean }
): T[] {
  return findings.filter((f) => {
    if (!f.packageName) return true;
    return !isFrameworkProtectedDependency(f.packageName, framework, options);
  });
}
