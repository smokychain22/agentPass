import { ArrowRight } from "lucide-react";
import { SCAN_TO_PR_STEPS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

export function ScanToPrSection() {
  return (
    <div className="relative">
      <div className="hidden lg:flex items-stretch gap-0">
        <div
          className="pipeline-connector absolute left-[6%] right-[6%] top-[2.25rem] z-0 h-px"
          aria-hidden
        />
        {SCAN_TO_PR_STEPS.map((step, i) => (
          <div key={step} className="relative z-10 flex flex-1 flex-col items-center px-1">
            <div className="flex h-[4.5rem] w-full max-w-[9rem] flex-col items-center justify-center rounded-lg border border-electric/25 bg-[#0C1118] px-2 text-center shadow-mcc-glow">
              <span className="text-[11px] font-medium leading-tight text-[#F8FAFC]">{step}</span>
            </div>
            {i < SCAN_TO_PR_STEPS.length - 1 && (
              <ArrowRight
                className="absolute -right-2 top-[1.85rem] z-20 h-3.5 w-3.5 text-[#64748B]/60"
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:hidden">
        {SCAN_TO_PR_STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border font-mono text-xs text-electric">
              {i + 1}
            </span>
            <span
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                i === SCAN_TO_PR_STEPS.length - 1
                  ? "border-signal/30 bg-signal/5 text-signal"
                  : "border-border bg-card/40 text-foreground"
              )}
            >
              {step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
