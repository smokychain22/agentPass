import type { Finding } from "@/lib/findings/types";

export interface RepositoryContext {
  rootDir: string;
  commitSha: string;
  repositoryModel?: unknown;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface GeneratedChange {
  findingId: string;
  pluginId: string;
  originalHash?: string;
  modifiedHash?: string;
  changedFiles: string[];
  unifiedDiff: string;
  additions: number;
  deletions: number;
  originalSources: Record<string, string>;
  modifiedSources: Record<string, string>;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export interface FixPlugin {
  id: string;
  label: string;
  supports(finding: Finding, context: RepositoryContext): boolean;
  evaluate(finding: Finding, context: RepositoryContext): Promise<EligibilityResult>;
  generate(finding: Finding, workspace: string): Promise<GeneratedChange>;
  validate(change: GeneratedChange, workspace: string): Promise<ValidationResult>;
  rollback(change: GeneratedChange, workspace: string): Promise<void>;
}
