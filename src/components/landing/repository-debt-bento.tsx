import { Copy, Files, GitBranch, Package, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PROBLEM_CARDS } from "@/lib/marketing/content";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "Duplicate Logic": Copy,
  "Dead Files": Files,
  "Dependency Drift": Package,
  "Orphan Modules": GitBranch,
  "Fragile Cleanup Risk": ShieldAlert,
};

export function RepositoryDebtBento() {
  return (
    <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {PROBLEM_CARDS.map((card) => {
        const Icon = ICONS[card.title] ?? Files;
        const isLarge = card.size === "large";

        return (
          <Panel
            key={card.title}
            variant="elevated"
            padding="md"
            className={cn(
              "group flex flex-col transition-colors hover:border-electric/20",
              isLarge ? "sm:col-span-2" : "sm:col-span-1"
            )}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded border border-border/60 bg-card-elevated">
                <Icon className="h-4 w-4 text-electric" strokeWidth={1.5} aria-hidden />
              </div>
              <RiskBadge level={card.risk}>{card.signal}</RiskBadge>
            </div>

            <p className="ds-label">{card.category}</p>
            <h3 className="mt-1 text-base font-semibold text-foreground">{card.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
              {card.description}
            </p>

            <div className="mt-4 rounded border border-border/40 bg-[#05080D]/50 p-2.5">
              <p className="ds-label mb-1.5">Detection signal</p>
              <div className="space-y-1">
                {card.paths.map((path) => (
                  <p key={path} className="truncate font-mono text-[10px] text-muted-foreground">
                    {path}
                  </p>
                ))}
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
