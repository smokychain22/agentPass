import type {
  ClassificationLabel,
  ClassificationState,
  DeletionProof,
  EvidenceBundle,
  EvidenceItem,
  FindingAction,
  FindingType,
  FusionEvidenceGrade,
} from "@/lib/findings/types";

export type {
  ClassificationLabel,
  ClassificationState,
  DeletionProof,
  EvidenceBundle,
  EvidenceItem,
  FusionEvidenceGrade,
};

export type EvidenceChannel =
  | "analyzer"
  | "graph"
  | "framework"
  | "configuration"
  | "script"
  | "runtime"
  | "git"
  | "counter";

export interface ClassificationDecision {
  action: FindingAction;
  grade: FusionEvidenceGrade;
  classificationState: ClassificationState;
  classificationLabel: ClassificationLabel;
  decisionReason: string;
  autoFixAllowed: boolean;
  evidence: EvidenceBundle;
  deletionProof?: DeletionProof;
}

export interface ReferenceChannelStatus {
  staticImports: boolean;
  dynamicImports: boolean;
  configuration: boolean;
  scripts: boolean;
  packageExports: boolean;
  frameworkEntryPoint: boolean;
  incomplete: string[];
}

export const CATEGORY_VERIFICATION: Partial<Record<FindingType, string[]>> = {
  unused_import: ["parse", "typecheck", "build"],
  unused_file: ["import_graph", "route_comparison", "typecheck", "build", "tests"],
  unused_dependency: ["clean_install", "lockfile", "typecheck", "lint", "build"],
  duplicate_code: ["reference_update", "canonical_export", "typecheck", "build"],
  orphan_pattern: ["reachability", "typecheck", "build"],
};
