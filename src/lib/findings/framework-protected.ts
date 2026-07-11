/** Framework and tooling paths/deps that must not be flagged as unused by fallback analyzers. */

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
