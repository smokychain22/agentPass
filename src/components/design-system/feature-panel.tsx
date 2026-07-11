import { cn } from "@/lib/utils";
import { Panel, type PanelProps } from "./panel";

interface FeaturePanelProps extends PanelProps {
  label?: string;
  title: string;
  description?: string;
}

export function FeaturePanel({
  label,
  title,
  description,
  children,
  className,
  ...panelProps
}: FeaturePanelProps) {
  return (
    <Panel className={cn("flex flex-col", className)} {...panelProps}>
      {label && <p className="ds-label mb-2">{label}</p>}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {children}
    </Panel>
  );
}
