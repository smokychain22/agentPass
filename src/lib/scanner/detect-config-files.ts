import fs from "node:fs/promises";
import path from "node:path";
import { ENV_WARNING } from "./types";

const CONFIG_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /^package\.json$/, label: "package.json" },
  { pattern: /^tsconfig\.json$/, label: "tsconfig.json" },
  { pattern: /^next\.config\.(js|mjs|ts|cjs)$/, label: "next.config.*" },
  { pattern: /^vite\.config\.(js|ts|mjs|cjs)$/, label: "vite.config.*" },
  { pattern: /^tailwind\.config\.(js|ts|mjs|cjs)$/, label: "tailwind.config.*" },
  { pattern: /^eslint\.config\.(js|mjs|cjs|ts)$/, label: "eslint.config.*" },
  { pattern: /^\.eslintrc(\.(js|json|cjs|yaml|yml))?$/, label: "eslint config" },
  { pattern: /^\.env\.example$/, label: ".env.example" },
  { pattern: /^\.env$/, label: ".env" },
  { pattern: /^vercel\.json$/, label: "vercel.json" },
];

function matchConfig(filename: string): string | null {
  for (const { pattern, label } of CONFIG_PATTERNS) {
    if (pattern.test(filename)) return label;
  }
  return null;
}

export interface ConfigDetection {
  configFiles: string[];
  warnings: string[];
}

export async function detectConfigFiles(
  rootDir: string,
  relativePaths: string[]
): Promise<ConfigDetection> {
  const found = new Set<string>();
  const warnings: string[] = [];
  let hasEnv = false;

  for (const rel of relativePaths) {
    const base = path.basename(rel);

    if (rel === "supabase/config.toml" || rel.endsWith("/supabase/config.toml")) {
      found.add("supabase/config.toml");
      continue;
    }

    const label = matchConfig(base);
    if (label) {
      if (label === ".env") {
        hasEnv = true;
        found.add(".env");
      } else {
        found.add(base === label ? label : rel.split("/").pop() ?? label);
      }
    }
  }

  try {
    const rootEntries = await fs.readdir(rootDir);
    for (const entry of rootEntries) {
      const label = matchConfig(entry);
      if (label === ".env") hasEnv = true;
      if (label) found.add(entry);
    }
  } catch {
    /* ignore */
  }

  if (hasEnv && !warnings.includes(ENV_WARNING)) {
    warnings.push(ENV_WARNING);
  }

  const priority = [
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "next.config.js",
    "next.config.mjs",
    "vite.config.ts",
    "tailwind.config.ts",
    "tailwind.config.js",
    "eslint.config.js",
    ".env.example",
    ".env",
    "vercel.json",
    "supabase/config.toml",
  ];

  const configFiles = [...found].sort((a, b) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return { configFiles, warnings };
}
