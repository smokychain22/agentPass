import { cn } from "@/lib/utils";

type RiskLevel = "safe" | "review" | "protected" | "danger" | "neutral" | "cyan" | "violet" | "mint";

const styles: Record<RiskLevel, string> = {
  safe: "border-signal/30 bg-signal/10 text-signal",
  mint: "border-signal/30 bg-signal/10 text-signal",
  review: "border-warning/30 bg-warning/10 text-warning",
  protected: "border-border bg-muted/40 text-muted-foreground",
  danger: "border-danger/30 bg-danger/10 text-danger",
  neutral: "border-border bg-card text-muted-foreground",
  cyan: "border-electric/30 bg-electric/10 text-electric",
  violet: "border-violet/30 bg-violet/10 text-violet",
};

interface RiskBadgeProps {
  children: React.ReactNode;
  level?: RiskLevel;
  className?: string;
}

export function RiskBadge({ children, level = "neutral", className }: RiskBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        styles[level],
        className
      )}
    >
      {children}
    </span>
  );
}
