import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import { ephemeralRuntimeRoot, isServerlessRuntime } from "@/lib/server/runtime-env";

const WORKSPACE_DIAGNOSTICS = process.env.REPODIET_WORKSPACE_DIAGNOSTICS === "1";

export interface ScanWorkspace {
  root: string;
  archivePath: string;
  extractPath: string;
  reportsPath: string;
  artifactsPath: string;
}

function resolveRuntimeRoot(): string {
  return isServerlessRuntime()
    ? ephemeralRuntimeRoot()
    : path.join(process.cwd(), ".repodiet-runtime");
}

export function getRuntimeRoot(): string {
  return resolveRuntimeRoot();
}

export async function ensureRuntimeRoot(): Promise<string> {
  const root = resolveRuntimeRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

export async function createScanWorkspace(prefix = "scan"): Promise<ScanWorkspace> {
  const root = await ensureRuntimeRoot();
  const workspace: ScanWorkspace = {
    root: path.join(root, `${prefix}-${nanoid()}`),
    archivePath: "",
    extractPath: "",
    reportsPath: "",
    artifactsPath: "",
  };

  workspace.archivePath = path.join(workspace.root, "repository.zip");
  workspace.extractPath = path.join(workspace.root, "repository");
  workspace.reportsPath = path.join(workspace.root, "reports");
  workspace.artifactsPath = path.join(workspace.root, "artifacts");

  await fs.mkdir(workspace.root, { recursive: true });
  await fs.mkdir(workspace.extractPath, { recursive: true });
  await fs.mkdir(workspace.reportsPath, { recursive: true });
  await fs.mkdir(workspace.artifactsPath, { recursive: true });

  if (WORKSPACE_DIAGNOSTICS) {
    console.info("[workspace]", {
      cwd: process.cwd(),
      tmpdir: os.tmpdir(),
      workspaceRoot: workspace.root,
      vercel: Boolean(process.env.VERCEL),
    });
  }

  return workspace;
}

export async function removeWorkspace(workspacePath: string): Promise<void> {
  if (!workspacePath) return;

  const normalized = path.resolve(workspacePath);
  const allowedRoot = path.resolve(resolveRuntimeRoot());

  if (
    normalized === allowedRoot ||
    !normalized.startsWith(`${allowedRoot}${path.sep}`)
  ) {
    throw new Error("Refusing to remove path outside RepoDiet runtime root");
  }

  await fs.rm(normalized, { recursive: true, force: true });
}
