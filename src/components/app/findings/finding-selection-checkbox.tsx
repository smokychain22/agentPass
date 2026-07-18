"use client";

import { cn } from "@/lib/utils";
import type { FindingSelectionPurpose } from "@/lib/findings/selection-purposes";

interface FindingSelectionCheckboxProps {
  findingId: string;
  title: string;
  checked: boolean;
  enabled: boolean;
  purpose?: FindingSelectionPurpose | "none";
  ariaLabel?: string;
  onToggle: (findingId: string) => void;
  className?: string;
}

/**
 * Per-finding checkbox. Purpose is cleanup | review | inspection.
 * Selection is keyed by stable finding ID; purposes never mix.
 */
export function FindingSelectionCheckbox({
  findingId,
  title,
  checked,
  enabled,
  purpose = "none",
  ariaLabel,
  onToggle,
  className,
}: FindingSelectionCheckboxProps) {
  const label =
    ariaLabel ??
    (purpose === "review"
      ? "Select for deeper review"
      : purpose === "inspection"
        ? `Select ${title} for inspection`
        : purpose === "cleanup"
          ? `Select ${title} for cleanup`
          : `${title} — Not eligible for automatic cleanup`);

  const cleanupEligible = purpose === "cleanup" && enabled;

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
        data-selection-purpose={purpose}
        data-cleanup-eligible={cleanupEligible ? "true" : "false"}
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
            ? purpose === "review"
              ? "border-amber-400/80 accent-amber-400"
              : purpose === "inspection"
                ? "border-muted-foreground/70 accent-muted-foreground"
                : "border-[hsl(var(--signal))] accent-[hsl(var(--signal))]"
            : "border-muted-foreground/50 opacity-45"
        )}
      />
    </label>
  );
}
