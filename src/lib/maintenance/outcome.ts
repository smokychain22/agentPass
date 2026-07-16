import { flattenFindings } from "@/lib/findings/client";
import type { FindingsPayload, Finding } from "@/lib/findings/types";
import type { ChangeOperation } from "@/lib/patch-kit/canonical-patch";

export interface ExactDuplicateCanonicalizationOutcome {
  canonicalPath: string;
  contentHash: string;
  beforeImplementations: number;
  afterImplementations: 1;
  removedDuplicatePaths: string[];
  rewiredImporterPaths: string[];
  findingIds: string[];
  proofBasis: "byte_identical_content_and_patch_operation";
}

export interface MaintenanceOutcome {
  kind: "exact_duplicate_canonicalization" | "bounded_repository_cleanup";
  headline: string;
  sourceCommit?: string;
  canonicalizations: ExactDuplicateCanonicalizationOutcome[];
  changedPaths: string[];
  editedPaths: string[];
  deletedPaths: string[];
  addedPaths: string[];
  verificationStatus: string;
  deliveryState: "prepared" | "delivered";
  evidenceStatement: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function signalValue(finding: Finding, prefix: string): string | undefined {
  return finding.evidence.signals
    .find((signal) => signal.startsWith(prefix))
    ?.slice(prefix.length);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort();
}

function operationsForFinding(
  operations: ChangeOperation[],
  findingId: string
): ChangeOperation[] {
  return operations.filter((operation) => operation.findingIds.includes(findingId));
}

/**
 * Describes the repository change prepared for, or delivered to, the buyer.
 * Canonicalization claims are emitted only when exact-hash evidence is joined
 * to a concrete delete operation for the same finding.
 */
export function buildMaintenanceOutcome(input: {
  findings: FindingsPayload;
  changeOperations?: ChangeOperation[];
  verificationStatus?: string;
  deliveryState?: "prepared" | "delivered";
}): MaintenanceOutcome {
  const operations = input.changeOperations ?? [];
  const groups = new Map<
    string,
    {
      canonicalPath: string;
      contentHash: string;
      removedDuplicatePaths: Set<string>;
      rewiredImporterPaths: Set<string>;
      findingIds: Set<string>;
    }
  >();

  for (const finding of flattenFindings(input.findings)) {
    if (!finding.evidence.signals.includes("exact_file_duplicate=true")) continue;
    const canonicalPath = signalValue(finding, "canonical=");
    const duplicatePath = signalValue(finding, "duplicate=");
    const contentHash = signalValue(finding, "content_hash=");
    if (!canonicalPath || !duplicatePath || !contentHash) continue;

    const normalizedCanonical = normalizePath(canonicalPath);
    const normalizedDuplicate = normalizePath(duplicatePath);
    const findingOperations = operationsForFinding(operations, finding.id);
    const patchDelete = findingOperations.some(
      (operation) =>
        operation.type === "delete" && normalizePath(operation.filePath) === normalizedDuplicate
    );
    if (!patchDelete) continue;

    const key = `${normalizedCanonical}\u0000${contentHash}`;
    const group = groups.get(key) ?? {
      canonicalPath: normalizedCanonical,
      contentHash,
      removedDuplicatePaths: new Set<string>(),
      rewiredImporterPaths: new Set<string>(),
      findingIds: new Set<string>(),
    };
    group.removedDuplicatePaths.add(normalizedDuplicate);
    group.findingIds.add(finding.id);
    for (const operation of findingOperations) {
      const operationPath = normalizePath(operation.filePath);
      if (
        operation.type === "edit" &&
        operationPath !== normalizedCanonical &&
        operationPath !== normalizedDuplicate
      ) {
        group.rewiredImporterPaths.add(operationPath);
      }
    }
    groups.set(key, group);
  }

  const canonicalizations = [...groups.values()]
    .map((group): ExactDuplicateCanonicalizationOutcome => {
      const removedDuplicatePaths = [...group.removedDuplicatePaths].sort();
      return {
        canonicalPath: group.canonicalPath,
        contentHash: group.contentHash,
        beforeImplementations: removedDuplicatePaths.length + 1,
        afterImplementations: 1,
        removedDuplicatePaths,
        rewiredImporterPaths: [...group.rewiredImporterPaths].sort(),
        findingIds: [...group.findingIds].sort(),
        proofBasis: "byte_identical_content_and_patch_operation",
      };
    })
    .sort((left, right) => left.canonicalPath.localeCompare(right.canonicalPath));

  const changedPaths = uniqueSorted(operations.map((operation) => operation.filePath));
  const editedPaths = uniqueSorted(
    operations.filter((operation) => operation.type === "edit").map((operation) => operation.filePath)
  );
  const deletedPaths = uniqueSorted(
    operations.filter((operation) => operation.type === "delete").map((operation) => operation.filePath)
  );
  const addedPaths = uniqueSorted(
    operations.filter((operation) => operation.type === "add").map((operation) => operation.filePath)
  );

  const deliveryState = input.deliveryState ?? "prepared";
  const beforeImplementations = canonicalizations.reduce(
    (total, group) => total + group.beforeImplementations,
    0
  );
  const afterImplementations = canonicalizations.length;
  const headline = canonicalizations.length > 0
    ? `${beforeImplementations} byte-identical implementation${beforeImplementations === 1 ? "" : "s"} ${deliveryState === "delivered" ? "consolidated" : "will be consolidated"} into ${afterImplementations} canonical implementation${afterImplementations === 1 ? "" : "s"}`
    : `${changedPaths.length} bounded repository change${changedPaths.length === 1 ? "" : "s"} ${deliveryState === "delivered" ? "delivered" : "prepared"} for review`;

  return {
    kind:
      canonicalizations.length > 0
        ? "exact_duplicate_canonicalization"
        : "bounded_repository_cleanup",
    headline,
    sourceCommit: input.findings.repo.commitSha,
    canonicalizations,
    changedPaths,
    editedPaths,
    deletedPaths,
    addedPaths,
    verificationStatus: input.verificationStatus ?? "unknown",
    deliveryState,
    evidenceStatement:
      canonicalizations.length > 0
        ? `Derived from byte-identical content hashes joined to ${deliveryState === "delivered" ? "the branch operations RepoDiet applied" : "the prepared patch operations"}.`
        : `Derived from ${deliveryState === "delivered" ? "the branch operations RepoDiet applied" : "the prepared patch operations"}; no architecture-level claim is made.`,
  };
}
