import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-electric text-[#05080D] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-electric/90 active:bg-electric/80",
        secondary:
          "border border-border bg-card-elevated text-foreground hover:border-electric/30 hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        outline:
          "border border-border bg-transparent text-foreground hover:border-electric/35 hover:bg-card",
        destructive:
          "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
        success:
          "border border-signal/30 bg-signal/10 text-signal hover:bg-signal/20",
        signal:
          "border border-signal/30 bg-signal/10 text-signal hover:bg-signal/20",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
