import { Shield, Ban, Lock, Eye, ListChecks } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SAFETY_CARDS } from "@/lib/marketing/content";
import { BentoCard } from "./bento-card";

const ICONS: Record<string, LucideIcon> = {
  "No repo mutation": Ban,
  "No auto-delete": Shield,
  "Protected files": Lock,
  "Fallback transparency": Eye,
  "Regression-first": ListChecks,
};

export function SafetyCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SAFETY_CARDS.map((card) => (
        <BentoCard
          key={card.title}
          category="Safety"
          title={card.title}
          description={card.description}
          icon={ICONS[card.title] ?? Shield}
        />
      ))}
    </div>
  );
}
