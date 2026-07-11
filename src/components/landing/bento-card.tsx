import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface BentoCardProps {
  category?: string;
  title: string;
  description: string;
  icon?: LucideIcon;
  className?: string;
  span?: "default" | "wide";
}

export function BentoCard({
  category,
  title,
  description,
  icon: Icon,
  className,
  span = "default",
}: BentoCardProps) {
  return (
    <div
      className={cn(
        "bento-glow mcc-panel group flex flex-col rounded-lg p-5",
        span === "wide" && "lg:col-span-2",
        className
      )}
    >
      {category && <p className="mono-label mb-3">{category}</p>}
      {Icon && (
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded border mcc-border bg-[#111821]">
          <Icon className="h-4 w-4 text-electric/90" strokeWidth={1.5} />
        </div>
      )}
      <h3 className="text-base font-semibold text-[#F8FAFC]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-secondary">{description}</p>
    </div>
  );
}
