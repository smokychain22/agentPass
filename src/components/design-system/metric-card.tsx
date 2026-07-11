import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "cyan" | "mint" | "amber" | "danger" | "neutral";
  className?: string;
}

const accentMap = {
  cyan: "text-electric",
  mint: "text-signal",
  amber: "text-warning",
  danger: "text-danger",
  neutral: "text-foreground",
};

export function MetricCard({
  label,
  value,
  hint,
  accent = "neutral",
  className,
}: MetricCardProps) {
  return (
    <div className={cn("ds-card-elevated rounded-lg p-4", className)}>
      <p className="ds-label">{label}</p>
      <p className={cn("mt-2 font-mono text-2xl font-semibold tabular-nums", accentMap[accent])}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
