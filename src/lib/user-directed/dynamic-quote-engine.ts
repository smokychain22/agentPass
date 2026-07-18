import { createHmac, randomBytes } from "node:crypto";
import { exactChargeLabelFromMicro } from "@/lib/pricing/exact-amount";
import type {
  DynamicQuoteComponent,
  DynamicSignedQuote,
  PaymentChannelChoice,
  TransformationPlan,
} from "./types";
import { hashScope } from "./plan-hash";

const DECIMALS = 6;
const BASE_EXECUTION_MICRO = BigInt(250000); // 0.25 USDT
const PER_PATH_MICRO = BigInt(150000); // 0.15 USDT per affected path
const PER_LINE_MICRO = BigInt(500); // 0.0005 USDT per changed line
const VALIDATION_MICRO = BigInt(200000); // 0.20 USDT
const COMPLEXITY_DELETE_MICRO = BigInt(100000);
const COMPLEXITY_EDIT_MICRO = BigInt(300000);
const COMPLEXITY_CONSOLIDATE_MICRO = BigInt(750000);
const COMPLEXITY_CUSTOM_MICRO = BigInt(500000);
const OKX_MARKETPLACE_MINIMUM_MICRO = BigInt(1000000); // display note / floor for marketplace channel
const QUOTE_TTL_MS = 30 * 60 * 1000;

function signingSecret(): string {
  return (
    process.env.REPODIET_QUOTE_SIGNING_SECRET ||
    process.env.REPODIET_X402_TEST_SECRET ||
    "repodiet-dev-quote-secret"
  );
}

function micro(n: bigint): string {
  return n.toString();
}

function sumMicro(parts: bigint[]): bigint {
  return parts.reduce((a, b) => a + b, BigInt(0));
}

function complexityMicro(plan: TransformationPlan): bigint {
  switch (plan.proposedAction) {
    case "DELETE":
      return COMPLEXITY_DELETE_MICRO;
    case "CONSOLIDATE_DUPLICATES":
    case "CHOOSE_CANONICAL":
      return COMPLEXITY_CONSOLIDATE_MICRO;
    case "EDIT":
    case "RENAME":
    case "MOVE":
    case "UPDATE_REFERENCES":
      return COMPLEXITY_EDIT_MICRO;
    case "CUSTOM":
    case "REGENERATE":
    case "UPDATE_CONFIGURATION":
      return COMPLEXITY_CUSTOM_MICRO;
    default:
      return COMPLEXITY_DELETE_MICRO;
  }
}

function lineDelta(plan: TransformationPlan): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const change of plan.fileChanges) {
    additions += change.additions ?? 0;
    deletions += change.deletions ?? (change.action === "delete" ? 1 : 0);
  }
  if (plan.unifiedDiff) {
    for (const line of plan.unifiedDiff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
  }
  return { additions, deletions };
}

export function computeDynamicQuoteComponents(
  plan: TransformationPlan
): DynamicQuoteComponent[] {
  const pathCount = Math.max(1, plan.selectedRepositoryPaths.length || plan.fileChanges.length);
  const { additions, deletions } = lineDelta(plan);
  const changedLines = BigInt(Math.max(0, additions + deletions));

  const components: DynamicQuoteComponent[] = [
    {
      type: "base_execution",
      label: "Base isolated execution",
      amountMicro: micro(BASE_EXECUTION_MICRO),
    },
    {
      type: "path_count",
      label: `Affected paths (${pathCount})`,
      amountMicro: micro(PER_PATH_MICRO * BigInt(pathCount)),
    },
    {
      type: "transformation_complexity",
      label: `Transformation (${plan.proposedAction.toLowerCase()})`,
      amountMicro: micro(complexityMicro(plan)),
    },
    {
      type: "validation",
      label: "Validation plan",
      amountMicro: micro(VALIDATION_MICRO + PER_LINE_MICRO * changedLines),
    },
  ];
  return components;
}

export function signDynamicQuotePayload(payload: Omit<DynamicSignedQuote, "signature">): string {
  const body = JSON.stringify({
    quoteId: payload.quoteId,
    amountAtomic: payload.amountAtomic,
    scopeHash: payload.scopeHash,
    planHash: payload.planHash,
    normalizedPatchHash: payload.normalizedPatchHash ?? "",
    paymentChannel: payload.paymentChannel,
    expiresAt: payload.expiresAt,
  });
  return createHmac("sha256", signingSecret()).update(body).digest("hex");
}

export function verifyDynamicQuoteSignature(quote: DynamicSignedQuote): boolean {
  const { signature, ...rest } = quote;
  const expected = signDynamicQuotePayload(rest);
  return expected === signature;
}

export function createDynamicSignedQuote(input: {
  plan: TransformationPlan;
  paymentChannel: PaymentChannelChoice;
  quoteId?: string;
}): DynamicSignedQuote {
  const { plan, paymentChannel } = input;
  if (!plan.executable || plan.status !== "PLAN_READY" || !plan.normalizedPatchHash) {
    throw new Error(
      "dynamic_quote_requires_executable_plan: no payable quote without a real preflight patch."
    );
  }

  const components = computeDynamicQuoteComponents(plan);
  let total = sumMicro(components.map((c) => BigInt(c.amountMicro)));
  let marketplaceNote: string | undefined;

  if (paymentChannel === "okx_a2a_marketplace" && total < OKX_MARKETPLACE_MINIMUM_MICRO) {
    components.push({
      type: "marketplace_minimum",
      label: "OKX marketplace minimum",
      amountMicro: micro(OKX_MARKETPLACE_MINIMUM_MICRO - total),
    });
    marketplaceNote =
      "OKX marketplace minimum applies. This floor is not the calculated cleanup cost alone.";
    total = OKX_MARKETPLACE_MINIMUM_MICRO;
  }

  const amountAtomic = micro(total);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const scopeHash = hashScope({
    repository: plan.repository,
    pinnedCommit: plan.pinnedCommit,
    selectedPaths: plan.selectedRepositoryPaths,
    selectedFindingIds: plan.selectedFindingIds,
    requestedActions: plan.requestedActions,
  });

  const unsigned: Omit<DynamicSignedQuote, "signature"> = {
    quoteId: input.quoteId ?? `dquote_${randomBytes(8).toString("hex")}`,
    currency: "USDT",
    amountAtomic,
    amountDisplay: exactChargeLabelFromMicro(amountAtomic, "USDT"),
    decimals: DECIMALS,
    components,
    scopeHash,
    planHash: plan.planHash,
    repository: plan.repository,
    pinnedCommit: plan.pinnedCommit,
    selectedPathIds: plan.selectedRepositoryPaths.map((p) => `path_${p}`),
    selectedFindingIds: plan.selectedFindingIds,
    requestedActionIds: plan.requestedActions.map((a) => a.id),
    paymentChannel,
    normalizedPatchHash: plan.normalizedPatchHash,
    validationPlanHash: hashScope({
      repository: plan.repository,
      pinnedCommit: plan.pinnedCommit,
      selectedPaths: plan.validationCommands,
      selectedFindingIds: [],
      requestedActions: [],
    }),
    expiresAt,
    marketplaceNote,
    createdAt,
  };

  return {
    ...unsigned,
    signature: signDynamicQuotePayload(unsigned),
  };
}

export function assertQuoteMatchesPlan(
  quote: DynamicSignedQuote,
  plan: TransformationPlan
): void {
  if (!verifyDynamicQuoteSignature(quote)) {
    throw new Error("quote_signature_invalid");
  }
  if (quote.planHash !== plan.planHash) {
    throw new Error("quote_plan_hash_mismatch");
  }
  if (quote.normalizedPatchHash !== plan.normalizedPatchHash) {
    throw new Error("quote_patch_hash_mismatch");
  }
  if (quote.pinnedCommit !== plan.pinnedCommit) {
    throw new Error("quote_pinned_commit_mismatch");
  }
  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    throw new Error("quote_expired");
  }
  if (quote.amountAtomic !== quote.components.reduce((sum, c) => {
    return (BigInt(sum) + BigInt(c.amountMicro)).toString();
  }, "0")) {
    // components must sum to atomic amount (server integrity)
    const sum = quote.components.reduce((acc, c) => acc + BigInt(c.amountMicro), BigInt(0));
    if (sum.toString() !== quote.amountAtomic) {
      throw new Error("quote_amount_component_mismatch");
    }
  }
}

export function rejectClientModifiedPrice(input: {
  quote: DynamicSignedQuote;
  clientAmountAtomic?: string;
}): void {
  if (
    input.clientAmountAtomic != null &&
    input.clientAmountAtomic !== input.quote.amountAtomic
  ) {
    throw new Error("client_price_modification_rejected");
  }
}
