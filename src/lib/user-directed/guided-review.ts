import type { Finding } from "@/lib/findings/types";
import { automationBlockReason } from "@/lib/findings/plain-language";

export type GuidedReviewChoice = "yes_keep" | "no_verify_deletion" | "not_sure";

export interface GuidedReviewPrompt {
  findingId: string;
  path: string;
  question: string;
  choices: Array<{ id: GuidedReviewChoice; label: string }>;
  blockerDetail?: string;
}

/**
 * Ask one targeted question — never a 14-option operation dropdown.
 */
export function buildGuidedReviewPrompt(finding: Finding): GuidedReviewPrompt {
  const path = finding.files[0] ?? finding.title;
  const signals = finding.evidence.signals ?? [];
  const pluginLike = signals.some((s) =>
    /plugin|runtime|convention|dynamic|glob_ref|side.?effect|framework/i.test(s)
  );
  const stringRef = signals.some((s) => /string_ref|dynamic.?import/i.test(s));
  const blocker = automationBlockReason(finding) ?? finding.protectionReason;

  let question: string;
  if (pluginLike) {
    question = `This module is not imported, but its filename matches a runtime plugin pattern. Is “${path}” loaded externally by your application?`;
  } else if (stringRef) {
    question = `“${path}” has no static imports, but string or dynamic references may load it at runtime. Is it required by your application?`;
  } else if (finding.type === "duplicate_code") {
    question = `RepoDiet found similar code for “${path}”. Should we keep this path as the canonical copy?`;
  } else if (finding.type === "unused_dependency") {
    question = `Package “${finding.packageName ?? path}” is not referenced in the scanned import graph. Is it still required (CLI, peer, or optional runtime)?`;
  } else {
    question = `Evidence for “${path}” is incomplete. Is this path still required by your application?`;
  }

  return {
    findingId: finding.id,
    path,
    question,
    blockerDetail: blocker ?? undefined,
    choices: [
      { id: "yes_keep", label: "Yes, keep it" },
      { id: "no_verify_deletion", label: "No, verify deletion" },
      { id: "not_sure", label: "Not sure" },
    ],
  };
}
