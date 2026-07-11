import { BEFORE_DIFF_ITEMS, AFTER_DIFF_ITEMS, FLOW_METRICS } from "@/lib/marketing/content";
import { ArrowRight } from "lucide-react";

export function BeforeAfterDiff() {
  return (
    <div className="space-y-10">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Before — messy output */}
        <div className="mcc-panel overflow-hidden rounded-lg">
          <div className="border-b mcc-border bg-[#111821]/80 px-4 py-2.5">
            <p className="mono-label text-danger/90">Messy AI output</p>
          </div>
          <pre className="p-4 font-mono text-xs leading-relaxed text-secondary sm:text-sm">
            {BEFORE_DIFF_ITEMS.map((line) => (
              <span key={line} className="block">
                <span className="text-danger/80">- </span>
                {line}
              </span>
            ))}
          </pre>
        </div>

        {/* After — RepoDiet output */}
        <div className="mcc-panel overflow-hidden rounded-lg">
          <div className="border-b mcc-border bg-[#111821]/80 px-4 py-2.5">
            <p className="mono-label text-signal/90">RepoDiet output</p>
          </div>
          <div className="space-y-2 p-4">
            {AFTER_DIFF_ITEMS.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded border mcc-border bg-[#05070A]/60 px-3 py-2"
              >
                <span className="font-mono text-[11px] font-medium tracking-wide text-[#F8FAFC]">
                  {item.label}
                </span>
                <span className="font-mono text-[10px] text-secondary">{item.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {FLOW_METRICS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 sm:gap-3">
            <span className="rounded-md border mcc-border bg-[#0C1118] px-3 py-1.5 font-mono text-xs text-[#F8FAFC] sm:text-sm">
              {label}
            </span>
            {i < FLOW_METRICS.length - 1 && (
              <ArrowRight className="hidden h-4 w-4 text-[#64748B] sm:block" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
