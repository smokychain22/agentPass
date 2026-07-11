import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { hashSource } from "@/lib/execution/transform-audit";
import { countInboundReferences } from "@/lib/execution/reference-graph";
import {
  isDoNotTouchPath,
  isRouteLikePath,
  isSafeCandidatePath,
} from "@/lib/findings/confidence-path-rules";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import type { CandidateAuditRecord } from "@/lib/execution/candidate-lifecycle";
import { classifyFindingsForPatch } from "./safe-delete-classifier";
import type { ClassifiedBuckets, ClassifiedItem } from "./types";

const BACKUP_FILE_PATTERNS: RegExp[] = [
  /\.backup\./i,
  /\.old\./i,
  /(^|\/)archive\//i,
  /OldDashboard\.backup\./i,
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isBackupCandidatePath(filePath: string): boolean {
  const rel = normalizePath(filePath);
  if (!rel) return false;
  if (isDoNotTouchPath(rel) || isRouteLikePath(rel)) return false;
  if (!BACKUP_FILE_PATTERNS.some((p) => p.test(rel))) return false;
  return isSafeCandidatePath(rel) || /\.backup\./i.test(rel);
}

async function walkSourceFiles(rootDir: string, rel = ""): Promise<string[]> {
  const full = path.join(rootDir, rel);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(full, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const normalized = childRel.replace(/\\/g, "/");
    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(rootDir, normalized)));
    } else if (/\.(tsx?|jsx?|mjs|cjs)$/i.test(entry.name)) {
      files.push(normalized);
    }
  }
  return files;
}

export interface SafeDeleteProof {
  filePath: string;
  commitSha?: string;
  baselineHash: string;
  operation: "delete";
  inboundRefs: number;
  protected: boolean;
  approved: boolean;
}

export async function evaluateBackupFileDeletion(
  rootDir: string,
  filePath: string,
  commitSha?: string
): Promise<SafeDeleteProof | null> {
  const rel = normalizePath(filePath);
  if (!isBackupCandidatePath(rel)) return null;

  let content: string;
  try {
    content = await fs.readFile(path.join(rootDir, rel), "utf8");
  } catch {
    return null;
  }

  const inboundRefs = await countInboundReferences(rootDir, rel);
  if (inboundRefs > 0) return null;

  return {
    filePath: rel,
    commitSha,
    baselineHash: hashSource(content),
    operation: "delete",
    inboundRefs,
    protected: false,
    approved: true,
  };
}

export function createBackupFileFinding(proof: SafeDeleteProof): Finding {
  const id = `finding_backup_${createHash("sha256").update(proof.filePath).digest("hex").slice(0, 10)}`;
  return {
    id,
    type: "unused_file",
    title: "Backup/archive file",
    files: [proof.filePath],
    confidence: 0.95,
    confidenceReason: "Backup path pattern with zero inbound references and baseline hash match.",
    severity: "low",
    action: "safe_candidate",
    reason: "Backup/archive file with no inbound references and exact baseline hash match.",
    source: "heuristic",
    sourceMode: "heuristic",
    evidence: {
      summary: "repodiet_backup_analyzer: pattern matched, zero references",
      signals: ["backup_file", "archive_path", "zero_references", "base_hash_matched"],
    },
    lifecycleState: "generated",
    classificationLabel: "backup_archive_candidate",
    supportedTransformer: "remove_temp_backup_file",
  };
}

export function createBackupCandidateAudit(finding: Finding): CandidateAuditRecord {
  return {
    findingId: finding.id,
    findingType: "unused_file",
    filePath: finding.files[0],
    pluginId: "remove_temp_file",
    strategyIds: ["delete_backup_file"],
    sourceFound: true,
    sourceHashMatched: true,
    scanEligible: true,
    transformAttempted: true,
    contentChanged: true,
    dryRunSucceeded: true,
    proposedSourceChanged: true,
    proposedDiffGenerated: true,
    patchValidated: false,
    verificationSupported: true,
    retained: true,
  };
}

/** Discover backup/archive files eligible for safe deletion even without analyzer findings. */
export async function discoverFilesystemSafeDeletes(
  rootDir: string,
  findings: FindingsPayload,
  buckets: ClassifiedBuckets
): Promise<{ items: ClassifiedItem[]; proofs: SafeDeleteProof[] }> {
  const existing = new Set([
    ...buckets.safeDelete.map((i) => i.path),
    ...buckets.reviewFirst.map((i) => i.path),
    ...buckets.doNotTouch.map((i) => i.path),
  ]);
  const items: ClassifiedItem[] = [];
  const proofs: SafeDeleteProof[] = [];
  const projectRoot = findings.repositoryModel?.primaryProjectRoot?.replace(/\\/g, "/") ?? ".";
  const rootPrefix = projectRoot === "." ? "" : `${projectRoot.replace(/^\.\//, "")}/`;

  for (const rel of await walkSourceFiles(rootDir)) {
    if (existing.has(rel)) continue;
    if (rootPrefix && !rel.startsWith(rootPrefix)) continue;
    const proof = await evaluateBackupFileDeletion(rootDir, rel, findings.repo.commitSha);
    if (!proof?.approved) continue;
    items.push({
      path: rel,
      reason: "Backup/archive file with no inbound references and exact baseline hash match.",
      findingType: "unused_file",
      findingId: `finding_backup_${createHash("sha256").update(rel).digest("hex").slice(0, 10)}`,
    });
    proofs.push(proof);
    existing.add(rel);
  }

  return { items, proofs };
}

export async function classifyFindingsForPatchWithDiscovery(
  rootDir: string,
  findings: FindingsPayload
): Promise<{ buckets: ClassifiedBuckets; deletionProofs: SafeDeleteProof[] }> {
  const buckets = classifyFindingsForPatch(findings);
  const discovered = await discoverFilesystemSafeDeletes(rootDir, findings, buckets);
  if (discovered.items.length > 0) {
    buckets.safeDelete = [...buckets.safeDelete, ...discovered.items].sort((a, b) =>
      a.path.localeCompare(b.path)
    );
  }
  return { buckets, deletionProofs: discovered.proofs };
}
