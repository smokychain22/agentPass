import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const panelVariants = cva("rounded-lg border transition-colors duration-200", {
  variants: {
    variant: {
      default: "ds-card",
      elevated: "ds-card-elevated",
      interactive: "ds-card-elevated hover:border-electric/25 hover:shadow-artifact-hover cursor-pointer",
      cyan: "ds-card border-electric/25 bg-electric/5",
      safe: "ds-card border-signal/25 bg-signal/5",
      review: "ds-card border-warning/25 bg-warning/5",
      danger: "ds-card border-danger/25 bg-danger/5",
      code: "ds-card bg-[#05080D] font-mono text-xs",
    },
    padding: {
      none: "",
      sm: "p-4",
      md: "p-5",
      lg: "p-6",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "md",
  },
});

export interface PanelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof panelVariants> {}

export function Panel({ className, variant, padding, ...props }: PanelProps) {
  return <div className={cn(panelVariants({ variant, padding }), className)} {...props} />;
}
