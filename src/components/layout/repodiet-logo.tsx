import Image from "next/image";
import { cn } from "@/lib/utils";

interface RepodietLogoProps {
  className?: string;
  iconClassName?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
}

const SIZE_MAP = {
  sm: { display: "h-7 w-7", asset: 128, px: 28 },
  md: { display: "h-8 w-8", asset: 128, px: 32 },
  lg: { display: "h-10 w-10", asset: 256, px: 40 },
} as const;

export function RepodietLogo({
  className,
  iconClassName,
  showWordmark = true,
  size = "md",
}: RepodietLogoProps) {
  const spec = SIZE_MAP[size];
  const asset =
    spec.asset >= 256 ? "/brand/repodiet-mark-256.png" : "/brand/repodiet-mark-128.png";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src={asset}
        alt="RepoDiet"
        width={spec.asset}
        height={spec.asset}
        quality={100}
        className={cn(spec.display, "shrink-0 object-contain", iconClassName)}
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
