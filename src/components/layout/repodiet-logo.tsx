import Image from "next/image";
import { cn } from "@/lib/utils";

interface RepodietLogoProps {
  className?: string;
  iconClassName?: string;
  showWordmark?: boolean;
  size?: "sm" | "md";
}

export function RepodietLogo({
  className,
  iconClassName,
  showWordmark = true,
  size = "md",
}: RepodietLogoProps) {
  const iconSize = size === "sm" ? 28 : 32;

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/brand/repodiet-icon.png"
        alt="RepoDiet logo"
        width={iconSize}
        height={iconSize}
        className={cn("h-7 w-7 object-contain", iconClassName)}
        priority
      />
      {showWordmark && (
        <span className="text-sm font-semibold tracking-tight text-foreground transition-colors">
          RepoDiet
        </span>
      )}
    </span>
  );
}
