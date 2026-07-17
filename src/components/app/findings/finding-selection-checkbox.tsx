"use client";

import { cn } from "@/lib/utils";

interface FindingSelectionCheckboxProps {
  findingId: string;
  title: string;
  checked: boolean;
  enabled: boolean;
  onToggle: (findingId: string) => void;
  className?: string;
}

/**
 * Per-finding cleanup checkbox. Selection is keyed by stable finding ID.
 * Disabled for review-first / do-not-touch / non-eligible findings.
 */
export function FindingSelectionCheckbox({
  findingId,
  title,
  checked,
  enabled,
  onToggle,
  className,
}: FindingSelectionCheckboxProps) {
  const label = enabled
    ? `Select ${title} for cleanup`
    : `${title} — Not eligible for automatic cleanup`;

  return (
    <label
      className={cn(
        "flex shrink-0 items-start px-3 py-3",
        enabled ? "cursor-pointer" : "cursor-not-allowed",
        className
      )}
      title={enabled ? undefined : "Not eligible for automatic cleanup"}
      onClick={(event) => {
        // Prevent row expand / inspect handlers from firing.
        event.stopPropagation();
      }}
    >
      <input
        type="checkbox"
        data-finding-checkbox={findingId}
        data-cleanup-eligible={enabled ? "true" : "false"}
        checked={checked}
        disabled={!enabled}
        onChange={() => {
          if (!enabled) return;
          onToggle(findingId);
        }}
        onClick={(event) => event.stopPropagation()}
        aria-label={label}
        className={cn(
          "mt-1 h-4 w-4 shrink-0 rounded-sm border-2 bg-[#0B1220]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
          enabled
            ? "border-[hsl(var(--signal))] accent-[hsl(var(--signal))]"
            : "border-muted-foreground/50 opacity-45"
        )}
      />
    </label>
  );
}
