import { Shield } from "lucide-react";
import {
  SAFETY_PRINCIPLES,
  SAFETY_PROTECTED_CATEGORIES,
} from "@/lib/marketing/content";
import { Panel } from "@/components/design-system/panel";

export function SafetyBoundary() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
      {/* Central protected zone visualization */}
      <div className="relative mx-auto aspect-square w-full max-w-sm">
        <div className="absolute inset-0 rounded-full border border-signal/20 bg-signal/[0.03]" />
        <div className="absolute inset-[12%] rounded-full border border-signal/30 bg-signal/[0.05]" />
        <div className="absolute inset-[24%] flex flex-col items-center justify-center rounded-full border border-signal/40 bg-[#05080D]/80 text-center">
          <Shield className="h-8 w-8 text-signal" strokeWidth={1.5} aria-hidden />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-signal">
            Protected Zone
          </p>
          <p className="mt-1 px-4 text-[10px] text-muted-foreground">
            Default-deny cleanup boundary
          </p>
        </div>

        {SAFETY_PROTECTED_CATEGORIES.map((cat) => {
          const radius = 42;
          const angleRad = (cat.angle * Math.PI) / 180;
          const x = 50 + radius * Math.cos(angleRad - Math.PI / 2);
          const y = 50 + radius * Math.sin(angleRad - Math.PI / 2);

          return (
            <div
              key={cat.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span className="whitespace-nowrap rounded border border-border/60 bg-card-elevated px-2 py-1 font-mono text-[9px] text-foreground shadow-sm">
                {cat.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Principles */}
      <div className="space-y-3">
        {SAFETY_PRINCIPLES.map((principle) => (
          <Panel key={principle.title} variant="elevated" padding="sm" className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-signal/30 bg-signal/10">
              <Shield className="h-3 w-3 text-signal" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{principle.title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {principle.description}
              </p>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
