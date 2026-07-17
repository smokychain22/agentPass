"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface FindingsAccordionProps {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

/** Accessible accordion section for findings READY page. */
export function FindingsAccordion({
  title,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: FindingsAccordionProps) {
  const id = useId();
  const panelId = `${id}-panel`;
  const buttonId = `${id}-button`;
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : undefined;

  if (isControlled) {
    return (
      <div className={cn("rounded-md border border-border/50 bg-card/30", className)}>
        <button
          type="button"
          id={buttonId}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => onOpenChange?.(!isOpen)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          <span>
            <span className="block text-sm font-medium text-foreground">{title}</span>
            {summary ? (
              <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                {summary}
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {isOpen ? (
          <div id={panelId} role="region" aria-labelledby={buttonId} className="border-t border-border/40 px-4 py-3">
            {children}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <details
      className={cn("rounded-md border border-border/50 bg-card/30", className)}
      open={defaultOpen}
    >
      <summary
        id={buttonId}
        aria-controls={panelId}
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric [&::-webkit-details-marker]:hidden"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">{title}</span>
          {summary ? (
            <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground [[details[open]_&]]:rotate-180" aria-hidden />
      </summary>
      <div id={panelId} role="region" aria-labelledby={buttonId} className="border-t border-border/40 px-4 py-3">
        {children}
      </div>
    </details>
  );
}
