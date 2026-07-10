import { z } from "zod";

export const ScanPhaseSchema = z.enum([
  "pending",
  "validating",
  "resolving",
  "fetching",
  "unpacking",
  "inventorying",
  "detecting",
  "detecting_roots",
  "detecting_protected",
  "persisting",
  "scanning",
  "complete",
  "failed",
]);

export type ScanPhase = z.infer<typeof ScanPhaseSchema>;

export const FrameworkNameSchema = z.enum([
  "Next.js",
  "React",
  "Vite",
  "Remix",
  "Astro",
  "Node/Express",
  "Unknown JS/TS",
]);

export type FrameworkName = z.infer<typeof FrameworkNameSchema>;

export const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun"]);

export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const ParsedGitHubUrlSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  branch: z.string().optional(),
});

export type ParsedGitHubUrl = z.infer<typeof ParsedGitHubUrlSchema>;

export const FrameworkDetectionSchema = z.object({
  name: FrameworkNameSchema,
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()),
});

export type FrameworkDetection = z.infer<typeof FrameworkDetectionSchema>;

export const FileSummarySchema = z.object({
  totalFiles: z.number(),
  totalFolders: z.number(),
  totalSizeKb: z.number(),
  topExtensions: z.record(z.string(), z.number()),
});

export type FileSummary = z.infer<typeof FileSummarySchema>;

export const ScanResultSchema = z.object({
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    branch: z.string(),
    url: z.string(),
    commitSha: z.string().optional(),
  }),
  framework: FrameworkDetectionSchema,
  packageManager: PackageManagerSchema,
  packageManagerLockfile: z.string().optional(),
  summary: FileSummarySchema,
  topLevelFolders: z.array(z.string()),
  configFiles: z.array(z.string()),
  largestFiles: z.array(z.object({ path: z.string(), sizeKb: z.number() })).optional(),
  warnings: z.array(z.string()),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

export const ScanRecordSchema = z.object({
  id: z.string(),
  status: ScanPhaseSchema,
  url: z.string(),
  branch: z.string().optional(),
  error: z.string().optional(),
  result: ScanResultSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ScanRecord = z.infer<typeof ScanRecordSchema>;

export const RunScanDirectBodySchema = z.object({
  repoUrl: z.string().min(1),
  branch: z.string().optional(),
});

export const ENV_WARNING =
  ".env file detected — values not read or displayed.";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".cache",
]);
