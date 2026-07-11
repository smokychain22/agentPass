import { cn } from "@/lib/utils";

interface GridBackgroundProps {
  className?: string;
  variant?: "hero" | "section" | "subtle";
}

export function GridBackground({ className, variant = "section" }: GridBackgroundProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0",
        variant === "hero" && "landing-grid landing-glow",
        variant === "section" && "landing-grid opacity-60",
        variant === "subtle" && "opacity-40",
        className
      )}
    />
  );
}
