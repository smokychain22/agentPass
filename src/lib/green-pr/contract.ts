import { z } from "zod";
import { canonicalDigest, canonicalJson } from "./canonical-json";
import {
  GREEN_PR_ALLOWED_OPERATIONS,
  GREEN_PR_CONTRACT_SCHEMA,
  GREEN_PR_CONTRACT_VERSION,
  REPODIET_OKX_A2A_SERVICE_ID,
  REPODIET_OKX_ASP_ID,
  REPODIET_SELLER,
  REPODIET_SETTLEMENT_ASSET,
  REPODIET_X_LAYER_NETWORK,
} from "./constants";
import { contractPathMatches, normalizeContractPath, normalizeProjectRoot } from "./path-policy";

const identifier = z.string().trim().min(1).max(200);
const commitSha = z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/);
const ethereumAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const positiveDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/).refine(
  (value) => Number(value) > 0,
  "Amount must be greater than zero."
);
const contractPath = z.string().transform((value, context) => {
  try {
    return normalizeContractPath(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid repository path.",
    });
    return z.NEVER;
  }
});

export const maintenanceContractSchema = z
  .object({
    schema: z.literal(GREEN_PR_CONTRACT_SCHEMA).default(GREEN_PR_CONTRACT_SCHEMA),
    contractVersion: z.literal(GREEN_PR_CONTRACT_VERSION),
    contractId: identifier,
    repository: z
      .object({
        owner: identifier,
        name: identifier,
        branch: identifier,
        sourceCommit: commitSha,
        projectRoot: z.string().transform((value, context) => {
          try {
            return normalizeProjectRoot(value);
          } catch (error) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: error instanceof Error ? error.message : "Invalid project root.",
            });
            return z.NEVER;
          }
        }),
      })
      .strict(),
    scope: z
      .object({
        findingIds: z.array(identifier).min(1),
        allowedPaths: z.array(contractPath).min(1),
        protectedPaths: z.array(contractPath),
        allowedOperations: z.array(z.enum(GREEN_PR_ALLOWED_OPERATIONS)).min(1),
        maxFilesChanged: z.number().int().positive(),
        maxLinesAdded: z.number().int().nonnegative(),
        maxLinesDeleted: z.number().int().positive(),
        maxDependencyChanges: z.number().int().nonnegative(),
      })
      .strict(),
    verificationPolicy: z
      .object({
        baselineRequired: z.boolean(),
        requiredCommands: z.array(identifier),
        requiredGitHubChecks: z.array(identifier),
        allowNewDiagnostics: z.boolean(),
        allowSkippedChecks: z.boolean(),
        timeoutSeconds: z.number().int().positive().max(3600),
      })
      .strict(),
    delivery: z
      .object({
        isolatedBranchRequired: z.literal(true),
        pullRequestRequired: z.literal(true),
        directMainPushAllowed: z.literal(false),
        autoMergeAllowed: z.literal(false),
        revisionLimit: z.number().int().nonnegative().max(10),
      })
      .strict(),
    commercialTerms: z
      .object({
        aspId: z.literal(REPODIET_OKX_ASP_ID),
        serviceId: z.literal(REPODIET_OKX_A2A_SERVICE_ID),
        quoteId: identifier,
        amount: positiveDecimal,
        asset: z.literal(REPODIET_SETTLEMENT_ASSET),
        network: z.literal(REPODIET_X_LAYER_NETWORK),
        payer: ethereumAddress,
        recipient: z.literal(REPODIET_SELLER),
        expiry: z.string().datetime({ offset: true }),
      })
      .strict(),
    acceptancePolicy: z
      .object({
        blockingChecksMustPass: z.boolean(),
        attestationMustVerify: z.boolean(),
        sourceCommitMustMatch: z.boolean(),
        scopeMustMatch: z.boolean(),
        receiptMustVerify: z.boolean(),
      })
      .strict(),
    warrantyPolicy: z
      .object({
        enabled: z.boolean(),
        durationHours: z.number().int().nonnegative().max(24 * 30),
        monitoredChecks: z.array(identifier),
        attributableRegressionAction: z.literal("OPEN_REPAIR"),
      })
      .strict(),
  })
  .strict()
  .superRefine((contract, context) => {
    const uniqueFields: Array<[string, string[]]> = [
      ["scope.findingIds", contract.scope.findingIds],
      ["scope.allowedPaths", contract.scope.allowedPaths],
      ["scope.protectedPaths", contract.scope.protectedPaths],
      ["scope.allowedOperations", contract.scope.allowedOperations],
      ["verificationPolicy.requiredCommands", contract.verificationPolicy.requiredCommands],
      ["verificationPolicy.requiredGitHubChecks", contract.verificationPolicy.requiredGitHubChecks],
    ];
    for (const [field, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${field} contains duplicates.` });
      }
    }

    for (const allowed of contract.scope.allowedPaths) {
      if (contract.scope.protectedPaths.some((protectedPath) =>
        contractPathMatches(protectedPath, allowed)
      )) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Allowed path is protected: ${allowed}`,
          path: ["scope", "allowedPaths"],
        });
      }
    }

    if (contract.verificationPolicy.baselineRequired &&
        contract.verificationPolicy.requiredCommands.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A baseline-required contract must include at least one required command.",
        path: ["verificationPolicy", "requiredCommands"],
      });
    }
    if (!contract.warrantyPolicy.enabled && contract.warrantyPolicy.durationHours !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A disabled warranty must have durationHours=0.",
        path: ["warrantyPolicy", "durationHours"],
      });
    }
  });

export type MaintenanceContractV1 = z.infer<typeof maintenanceContractSchema>;
export type GreenPrOperation = MaintenanceContractV1["scope"]["allowedOperations"][number];

export interface MaintenanceContractRecord {
  contractId: string;
  contractDigest: string;
  canonicalContract: string;
  contract: MaintenanceContractV1;
  status: "proposed" | "accepted" | "executing" | "delivered" | "rejected";
  createdAt: string;
  updatedAt: string;
  delivery?: {
    pullRequestUrl: string;
    receiptId: string;
    attestationId: string;
    deliveredAt: string;
  };
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function normalizeMaintenanceContract(input: unknown): MaintenanceContractV1 {
  const parsed = maintenanceContractSchema.parse(input);
  return maintenanceContractSchema.parse({
    ...parsed,
    scope: {
      ...parsed.scope,
      findingIds: sortUnique(parsed.scope.findingIds),
      allowedPaths: sortUnique(parsed.scope.allowedPaths),
      protectedPaths: sortUnique(parsed.scope.protectedPaths),
      allowedOperations: sortUnique(parsed.scope.allowedOperations),
    },
    verificationPolicy: {
      ...parsed.verificationPolicy,
      requiredCommands: sortUnique(parsed.verificationPolicy.requiredCommands),
      requiredGitHubChecks: sortUnique(parsed.verificationPolicy.requiredGitHubChecks),
    },
    warrantyPolicy: {
      ...parsed.warrantyPolicy,
      monitoredChecks: sortUnique(parsed.warrantyPolicy.monitoredChecks),
    },
  });
}

export function createMaintenanceContractRecord(
  input: unknown,
  now = new Date()
): MaintenanceContractRecord {
  const contract = normalizeMaintenanceContract(input);
  if (new Date(contract.commercialTerms.expiry).getTime() <= now.getTime()) {
    throw new Error("maintenance_contract_expired");
  }
  const canonicalContract = canonicalJson(contract);
  const timestamp = now.toISOString();
  return {
    contractId: contract.contractId,
    contractDigest: canonicalDigest(contract),
    canonicalContract,
    contract,
    status: "proposed",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function verifyMaintenanceContractRecord(
  record: MaintenanceContractRecord
): { valid: boolean; reason?: string } {
  try {
    const contract = normalizeMaintenanceContract(record.contract);
    const canonicalContract = canonicalJson(contract);
    if (canonicalContract !== record.canonicalContract) {
      return { valid: false, reason: "contract_canonical_payload_mismatch" };
    }
    if (canonicalDigest(contract) !== record.contractDigest) {
      return { valid: false, reason: "contract_digest_mismatch" };
    }
    if (contract.contractId !== record.contractId) {
      return { valid: false, reason: "contract_id_mismatch" };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "contract_invalid",
    };
  }
}
