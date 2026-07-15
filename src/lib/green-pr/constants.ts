import { getCanonicalOkxIdentity } from "@/lib/okx/identity";

const okxIdentity = getCanonicalOkxIdentity();

export const GREEN_PR_CONTRACT_SCHEMA = "repodiet.contract/v1" as const;
export const GREEN_PR_CONTRACT_VERSION = "1" as const;
export const GREEN_PR_PREDICATE_TYPE =
  "https://repodiet.dev/attestations/green-pr/v1" as const;
export const IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1" as const;
export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json" as const;

export const REPODIET_OKX_ASP_ID = okxIdentity.aspAgentId;
export const REPODIET_OKX_A2A_SERVICE_ID = okxIdentity.a2aServiceId;
export const REPODIET_OKX_A2MCP_SERVICE_ID = okxIdentity.a2mcpServiceId;
export const REPODIET_X_LAYER_NETWORK = okxIdentity.network;
export const REPODIET_SETTLEMENT_ASSET = okxIdentity.settlementAsset;
export const REPODIET_SELLER = okxIdentity.sellerWallet;

export const GREEN_PR_ALLOWED_OPERATIONS = [
  "remove_unused_import",
  "remove_unused_dependency",
  "remove_empty_file",
  "remove_backup_file",
  "remove_temporary_file",
  "delete_unreachable_module",
  "consolidate_exact_duplicate",
] as const;
