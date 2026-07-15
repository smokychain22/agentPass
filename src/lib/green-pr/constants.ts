export const GREEN_PR_CONTRACT_SCHEMA = "repodiet.contract/v1" as const;
export const GREEN_PR_CONTRACT_VERSION = "1" as const;
export const GREEN_PR_PREDICATE_TYPE =
  "https://repodiet.dev/attestations/green-pr/v1" as const;
export const IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1" as const;
export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json" as const;

export const REPODIET_OKX_ASP_ID = 5283 as const;
export const REPODIET_OKX_A2A_SERVICE_ID = 32947 as const;
export const REPODIET_OKX_A2MCP_SERVICE_ID = 32948 as const;
export const REPODIET_X_LAYER_NETWORK = "eip155:196" as const;
export const REPODIET_SETTLEMENT_ASSET =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;
export const REPODIET_SELLER =
  "0x1339724ada3adf04bb7a8ccc6498216214bbdf90" as const;

export const GREEN_PR_ALLOWED_OPERATIONS = [
  "remove_unused_import",
  "remove_unused_dependency",
  "remove_empty_file",
  "remove_backup_file",
  "remove_temporary_file",
  "delete_unreachable_module",
  "consolidate_exact_duplicate",
] as const;
