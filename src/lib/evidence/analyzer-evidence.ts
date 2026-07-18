import type { Finding } from "@/lib/findings/types";
import { hasExactDuplicateSignal } from "./exact-duplicate-signals";
import type { EvidenceItem } from "./types";

function signalValue(signals: string[], prefix: string): string | undefined {
  const hit = signals.find((s) => s.startsWith(`${prefix}=`));
  return hit?.slice(prefix.length + 1);
}

function signalBool(signals: string[], prefix: string): boolean {
  return signalValue(signals, prefix) === "true";
}

/** Extract structured supporting evidence from finding signals and metadata. */
export function extractAnalyzerEvidence(finding: Finding): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const signals = finding.evidence.signals;

  items.push({
    channel: "analyzer",
    source: finding.source,
    summary: finding.evidence.summary || finding.reason,
    strength: finding.sourceMode === "fallback" ? "neutral" : "supporting",
  });

  if (finding.sourceMode === "fallback" || finding.source.endsWith("_fallback")) {
    items.push({
      channel: "analyzer",
      source: finding.source,
      summary: "Analyzer ran in fallback mode — not native evidence.",
      strength: "contradicting",
    });
  }

  const inbound = signalValue(signals, "inbound_refs");
  if (inbound !== undefined) {
    items.push({
      channel: "graph",
      source: "repodiet_reference_graph",
      summary: `Inbound static import references: ${inbound}`,
      strength: Number(inbound) > 0 ? "contradicting" : "supporting",
    });
  }

  const exactDuplicate = hasExactDuplicateSignal(signals);
  const dupInbound = signalValue(signals, "inbound_refs_duplicate");
  if (dupInbound !== undefined) {
    // For exact file duplicates, inbound refs are rewire targets for
    // consolidate_exact_duplicate — not a reason to block cleanup.
    const inboundCount = Number(dupInbound);
    const strength =
      exactDuplicate || !(Number.isFinite(inboundCount) && inboundCount > 0)
        ? "supporting"
        : "contradicting";
    items.push({
      channel: "graph",
      source: "repodiet_reference_graph",
      summary: exactDuplicate
        ? `Inbound references to duplicate file: ${dupInbound} (rewire targets for consolidation)`
        : `Inbound references to duplicate file: ${dupInbound}`,
      strength,
    });
  }

  if (signalBool(signals, "empty_file")) {
    items.push({
      channel: "analyzer",
      source: "repodiet_hygiene",
      summary: "File is empty or whitespace-only.",
      strength: "supporting",
    });
  }

  if (exactDuplicate || signalBool(signals, "exact_duplicate")) {
    items.push({
      channel: "analyzer",
      source: "repodiet_exact_dup",
      summary: "Byte-identical duplicate detected.",
      strength: "supporting",
    });
  }

  const symbol = signalValue(signals, "symbol");
  if (finding.type === "unused_import" && symbol) {
    items.push({
      channel: "analyzer",
      source: finding.source,
      summary: `Unused import symbol: ${symbol}`,
      strength: "supporting",
    });
  }

  const preflight = signalValue(signals, "preflight");
  if (preflight === "actionable_candidate") {
    items.push({
      channel: "analyzer",
      source: "repodiet_preflight",
      summary: "Transformer preflight passed for exact source snapshot.",
      strength: "supporting",
    });
  } else if (preflight === "detected_candidate") {
    items.push({
      channel: "analyzer",
      source: "repodiet_preflight",
      summary: "Preflight did not confirm actionable transformation.",
      strength: "neutral",
    });
  }

  const blocker = signalValue(signals, "blockerCode");
  if (blocker) {
    items.push({
      channel: "analyzer",
      source: "repodiet_preflight",
      summary: `Preflight blocker: ${blocker}`,
      strength: "contradicting",
    });
  }

  return items;
}
