export type {
  ClassificationDecision,
  ClassificationLabel,
  ClassificationState,
  DeletionProof,
  EvidenceBundle,
  EvidenceChannel,
  EvidenceItem,
  FusionEvidenceGrade,
  ReferenceChannelStatus,
} from "./types";

export { CATEGORY_VERIFICATION } from "./types";
export { classifyFinding, classifyFindingsBatch } from "./classify-finding";
export { decideClassification } from "./decision-matrix";
export { buildDeletionProof } from "./deletion-proof";
export { extractAnalyzerEvidence } from "./analyzer-evidence";
export { searchCounterEvidence } from "./counter-evidence";
