import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { VerificationFailureCode } from "./verification-error-codes";

export interface ResolvedPackageInfo {
  packageName: string;
  declaredVersion?: string;
  installedVersion?: string;
  resolvedPath?: string;
  status: "installed" | "missing" | "not_declared";
}

export interface SwcBinaryDiagnostic {
  expectedPackage: string;
  installed: boolean;
  resolvedPath?: string;
}

export interface DependencyPreflightResult {
  passed: boolean;
  failureCode?: VerificationFailureCode;
  error?: string;
  packages: ResolvedPackageInfo[];
  swc?: SwcBinaryDiagnostic;
  runtime: {
    nodeVersion: string;
    npmVersion?: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  npmLsOutput?: string;
}

const SWC_PACKAGES = [
  "@next/swc-linux-x64-gnu",
  "@next/swc-linux-x64-musl",
  "@next/swc-linux-arm64-gnu",
  "@next/swc-linux-arm64-musl",
  "@next/swc-darwin-x64",
  "@next/swc-darwin-arm64",
  "@next/swc-win32-x64-msvc",
] as const;

function expectedSwcPackage(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "linux" && arch === "x64") return "@next/swc-linux-x64-gnu";
  if (platform === "linux" && arch === "arm64") return "@next/swc-linux-arm64-gnu";
  if (platform === "darwin" && arch === "x64") return "@next/swc-darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "@next/swc-darwin-arm64";
  if (platform === "win32" && arch === "x64") return "@next/swc-win32-x64-msvc";
  return null;
}

async function readDeclaredVersion(
  rootDir: string,
  packageName: string
): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName];
  } catch {
    return undefined;
  }
}

async function resolvePackage(rootDir: string, packageName: string): Promise<ResolvedPackageInfo> {
  const declaredVersion = await readDeclaredVersion(rootDir, packageName);
  if (!declaredVersion) {
    return { packageName, status: "not_declared" };
  }

  try {
    const script = `require.resolve('${packageName}/package.json')`;
    const result = await execa("node", ["-p", script], {
      cwd: rootDir,
      reject: false,
      timeout: 15_000,
    });
    if (result.exitCode !== 0) {
      return { packageName, declaredVersion, status: "missing" };
    }
    const resolvedPath = (result.stdout ?? "").trim();
    let installedVersion: string | undefined;
    try {
      const pkgJson = JSON.parse(
        await fs.readFile(resolvedPath, "utf8")
      ) as { version?: string };
      installedVersion = pkgJson.version;
    } catch {
      /* ignore */
    }
    return {
      packageName,
      declaredVersion,
      installedVersion,
      resolvedPath,
      status: "installed",
    };
  } catch {
    return { packageName, declaredVersion, status: "missing" };
  }
}

async function detectSwcBinary(rootDir: string): Promise<SwcBinaryDiagnostic | undefined> {
  const expected = expectedSwcPackage(process.platform, process.arch);
  if (!expected) return undefined;

  const full = path.join(rootDir, "node_modules", expected);
  try {
    await fs.access(path.join(full, "package.json"));
    const resolved = await execa("node", ["-p", `require.resolve('${expected}/package.json')`], {
      cwd: rootDir,
      reject: false,
      timeout: 15_000,
    });
    return {
      expectedPackage: expected,
      installed: resolved.exitCode === 0,
      resolvedPath: resolved.exitCode === 0 ? (resolved.stdout ?? "").trim() : undefined,
    };
  } catch {
    return { expectedPackage: expected, installed: false };
  }
}

async function runNpmLs(rootDir: string, packages: string[]): Promise<string> {
  const result = await execa(
    "npm",
    ["ls", ...packages, "--depth=0", "--json"],
    { cwd: rootDir, reject: false, timeout: 30_000 }
  );
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

export async function runDependencyPreflight(
  rootDir: string,
  options?: { frameworkPackages?: string[]; requireNextSwc?: boolean }
): Promise<DependencyPreflightResult> {
  const frameworkPackages = options?.frameworkPackages ?? ["next", "react", "react-dom"];
  const packages: ResolvedPackageInfo[] = [];

  for (const name of frameworkPackages) {
    packages.push(await resolvePackage(rootDir, name));
  }

  const missingDeclared = packages.filter(
    (p) => p.status === "missing" || (p.declaredVersion && p.status !== "installed")
  );

  let npmVersion: string | undefined;
  try {
    const npmV = await execa("npm", ["--version"], { reject: false, timeout: 10_000 });
    npmVersion = (npmV.stdout ?? "").trim() || undefined;
  } catch {
    /* ignore */
  }

  const npmLsOutput = await runNpmLs(
    rootDir,
    frameworkPackages.filter((p) => packages.find((x) => x.packageName === p)?.declaredVersion)
  );

  const swc = options?.requireNextSwc ? await detectSwcBinary(rootDir) : undefined;

  if (missingDeclared.length > 0) {
    const names = missingDeclared.map((p) => p.packageName).join(", ");
    return {
      passed: false,
      failureCode: "DECLARED_DEPENDENCY_NOT_INSTALLED",
      error: `Declared dependencies not installed: ${names}`,
      packages,
      swc,
      runtime: {
        nodeVersion: process.version,
        npmVersion,
        platform: process.platform,
        arch: process.arch,
      },
      npmLsOutput,
    };
  }

  if (swc && !swc.installed) {
    return {
      passed: false,
      failureCode: "NEXT_SWC_BINARY_MISSING",
      error: `Next.js SWC binary missing: ${swc.expectedPackage}`,
      packages,
      swc,
      runtime: {
        nodeVersion: process.version,
        npmVersion,
        platform: process.platform,
        arch: process.arch,
      },
      npmLsOutput,
    };
  }

  return {
    passed: true,
    packages,
    swc,
    runtime: {
      nodeVersion: process.version,
      npmVersion,
      platform: process.platform,
      arch: process.arch,
    },
    npmLsOutput,
  };
}

export function usesNextBuild(scripts: Record<string, string>): boolean {
  return scripts.build?.toLowerCase().includes("next") ?? false;
}

export { SWC_PACKAGES, expectedSwcPackage };
