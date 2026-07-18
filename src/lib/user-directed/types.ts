/**
 * User-directed cleanup contracts.
 * Selection ≠ eligibility. Only a verified TransformationPlan may execute.
 */

export type RequestedActionType =
  | "INSPECT"
  | "DELETE"
  | "EDIT"
  | "RENAME"
  | "MOVE"
  | "CONSOLIDATE_DUPLICATES"
  | "CHOOSE_CANONICAL"
  | "REMOVE_DEPENDENCY"
  | "UPDATE_REFERENCES"
  | "REGENERATE"
  | "KEEP"
  | "SUPPRESS"
  | "CUSTOM"
  | "UPDATE_CONFIGURATION"
  | "ADD_IGNORE_POLICY";

export type PlanAnalysisStatus =
  | "PLAN_READY"
  | "DEEPER_VERIFICATION_REQUIRED"
  | "USER_DECISION_REQUIRED"
  | "TRANSFORMER_UNAVAILABLE"
  | "PROTECTED_BY_POLICY"
  | "INVALID_AT_PINNED_COMMIT";

export type PaymentChannelChoice = "direct_website" | "okx_a2a_marketplace";

export interface RequestedAction {
  id: string;
  repository: string;
  pinnedCommit: string;
  pathIds: string[];
  findingIds: string[];
  actionType: RequestedActionType;
  userInstruction?: string;
  requestedAt: string;
  requestedBy: string;
  /** Optional rename/move targets */
  targetPath?: string;
  /** For duplicate groups — chosen canonical path */
  canonicalPath?: string;
}

export interface EvidenceFact {
  kind: "supporting" | "contradicting" | "neutral";
  source: string;
  detail: string;
}

export interface TransformationPlanFileChange {
  path: string;
  action: "create" | "edit" | "delete" | "rename";
  fromPath?: string;
  beforeHash?: string;
  afterHash?: string;
  additions?: number;
  deletions?: number;
}

export interface TransformationPlan {
  planId: string;
  repository: string;
  pinnedCommit: string;
  selectedRepositoryPaths: string[];
  selectedFindingIds: string[];
  requestedActions: RequestedAction[];
  status: PlanAnalysisStatus;
  executable: boolean;
  summary: string;
  evidence: EvidenceFact[];
  proposedAction: RequestedActionType;
  transformerId?: string;
  transformerAvailable: boolean;
  validationCommands: string[];
  predictedValidationSeconds?: number;
  unexpectedChangeBudget: number;
  rollbackPlan: string;
  fileChanges: TransformationPlanFileChange[];
  unifiedDiff?: string;
  normalizedPatchHash?: string;
  planHash: string;
  blockerReason?: string;
  nextStep?: string;
  riskTier: "low" | "medium" | "high" | "protected";
  createdAt: string;
  expiresAt?: string;
}

export interface UserDirectedSelection {
  selectedRepositoryPaths: string[];
  selectedFindingIds: string[];
  requestedActions: RequestedAction[];
  transformationPlans: TransformationPlan[];
  cleanupEligiblePlans: string[];
  blockedPlans: string[];
}

export interface DynamicQuoteComponent {
  type:
    | "base_execution"
    | "transformation_complexity"
    | "validation"
    | "path_count"
    | "marketplace_minimum"
    | "negotiated_okx_amount";
  label: string;
  amountMicro: string;
}

export interface DynamicSignedQuote {
  quoteId: string;
  currency: "USDT";
  amountAtomic: string;
  amountDisplay: string;
  decimals: number;
  components: DynamicQuoteComponent[];
  scopeHash: string;
  planHash: string;
  repository: string;
  pinnedCommit: string;
  selectedPathIds: string[];
  selectedFindingIds: string[];
  requestedActionIds: string[];
  paymentChannel: PaymentChannelChoice;
  normalizedPatchHash?: string;
  validationPlanHash?: string;
  expiresAt: string;
  signature: string;
  /** Marketing / marketplace note — never the payable charge alone */
  marketplaceNote?: string;
  createdAt: string;
}

export interface RepositoryPathNode {
  pathId: string;
  path: string;
  name: string;
  type: "blob" | "tree";
  sha?: string;
  size?: number;
  language?: string;
  generated?: boolean;
  vendor?: boolean;
  protected?: boolean;
  findingIds?: string[];
  inboundRefs?: number;
  indicators?: string[];
}
