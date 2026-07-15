import {
  verifyMaintenanceContractRecord,
  type GreenPrOperation,
  type MaintenanceContractRecord,
} from "../contract";
import { isPathAllowed, normalizeContractPath } from "../path-policy";

export interface ContractedChange {
  path: string;
  operation: GreenPrOperation;
  linesAdded: number;
  linesDeleted: number;
  dependencyChanges?: number;
}

export interface ExecutorDispatchRequest {
  contractDigest: string;
  sourceCommit: string;
  findingIds: string[];
  changes: ContractedChange[];
}

export interface AuthorizedExecutorDispatch extends ExecutorDispatchRequest {
  role: "executor";
  contractId: string;
  branchName: string;
  changes: ContractedChange[];
}

export interface ScopeValidationResult {
  valid: boolean;
  violations: string[];
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  dependencyChanges: number;
}

export function validateExecutionScope(
  record: MaintenanceContractRecord,
  request: ExecutorDispatchRequest
): ScopeValidationResult {
  const violations: string[] = [];
  const recordCheck = verifyMaintenanceContractRecord(record);
  if (!recordCheck.valid) violations.push(recordCheck.reason ?? "contract_invalid");
  if (record.status !== "accepted" && record.status !== "executing") {
    violations.push(`contract_not_accepted:${record.status}`);
  }
  if (request.contractDigest !== record.contractDigest) violations.push("contract_digest_mismatch");
  if (request.sourceCommit !== record.contract.repository.sourceCommit) {
    violations.push("source_commit_mismatch");
  }

  const contractedFindings = new Set(record.contract.scope.findingIds);
  if (request.findingIds.length === 0) violations.push("no_findings_selected");
  const requestedFindings = new Set(request.findingIds);
  for (const findingId of requestedFindings) {
    if (!contractedFindings.has(findingId)) violations.push(`finding_outside_scope:${findingId}`);
  }
  for (const findingId of contractedFindings) {
    if (!requestedFindings.has(findingId)) violations.push(`contracted_finding_missing:${findingId}`);
  }

  const normalizedChanges: ContractedChange[] = [];
  for (const change of request.changes) {
    let path = change.path;
    try {
      path = normalizeContractPath(change.path);
    } catch (error) {
      violations.push(error instanceof Error ? error.message : `invalid_path:${change.path}`);
      continue;
    }
    normalizedChanges.push({ ...change, path });
    if (!record.contract.scope.allowedOperations.includes(change.operation)) {
      violations.push(`operation_outside_scope:${change.operation}`);
    }
    if (!isPathAllowed(
      path,
      record.contract.scope.allowedPaths,
      record.contract.scope.protectedPaths
    )) {
      violations.push(`path_outside_scope:${path}`);
    }
    if (!Number.isInteger(change.linesAdded) || change.linesAdded < 0 ||
        !Number.isInteger(change.linesDeleted) || change.linesDeleted < 0) {
      violations.push(`invalid_line_count:${path}`);
    }
  }

  const filesChanged = new Set(normalizedChanges.map((change) => change.path)).size;
  const linesAdded = normalizedChanges.reduce((sum, change) => sum + change.linesAdded, 0);
  const linesDeleted = normalizedChanges.reduce((sum, change) => sum + change.linesDeleted, 0);
  const dependencyChanges = normalizedChanges.reduce(
    (sum, change) => sum + (change.dependencyChanges ?? 0),
    0
  );

  if (filesChanged === 0) violations.push("zero_executable_changes");
  if (filesChanged > record.contract.scope.maxFilesChanged) violations.push("max_files_exceeded");
  if (linesAdded > record.contract.scope.maxLinesAdded) violations.push("max_lines_added_exceeded");
  if (linesDeleted > record.contract.scope.maxLinesDeleted) {
    violations.push("max_lines_deleted_exceeded");
  }
  if (dependencyChanges > record.contract.scope.maxDependencyChanges) {
    violations.push("max_dependency_changes_exceeded");
  }

  return {
    valid: violations.length === 0,
    violations: [...new Set(violations)],
    filesChanged,
    linesAdded,
    linesDeleted,
    dependencyChanges,
  };
}

export function authorizeExecutorDispatch(
  record: MaintenanceContractRecord,
  request: ExecutorDispatchRequest
): AuthorizedExecutorDispatch {
  const validation = validateExecutionScope(record, request);
  if (!validation.valid) {
    throw new Error(`executor_dispatch_rejected:${validation.violations.join(",")}`);
  }
  return {
    ...request,
    role: "executor",
    contractId: record.contractId,
    branchName: `repodiet/green-pr-${record.contractId}-${record.contractDigest.slice(7, 19)}`,
    changes: request.changes.map((change) => ({
      ...change,
      path: normalizeContractPath(change.path),
    })),
  };
}
