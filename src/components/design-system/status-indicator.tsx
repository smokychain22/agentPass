import { cn } from "@/lib/utils";

interface StatusIndicatorProps {
  label: string;
  status?: "active" | "complete" | "pending" | "error";
  className?: string;
}

const statusStyles = {
  active: "border-electric/40 bg-electric/10 text-electric",
  complete: "border-signal/40 bg-signal/10 text-signal",
  pending: "border-border/60 bg-card text-muted-foreground",
  error: "border-danger/40 bg-danger/10 text-danger",
};

export function StatusIndicator({ label, status = "pending", className }: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        statusStyles[status],
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "active" && "bg-electric animate-pulse-subtle",
          status === "complete" && "bg-signal",
          status === "pending" && "bg-muted-foreground/50",
          status === "error" && "bg-danger"
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}
