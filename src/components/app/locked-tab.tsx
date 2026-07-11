"use client";

import { ReactNode } from "react";
import { SectionHeader } from "@/components/design-system/section-header";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle: string;
  badge?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, badge, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="ds-section-title">{title}</h1>
        {badge}
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {subtitle}
      </p>
    </div>
  );
}

interface LockedTabProps {
  title: string;
  description: string;
  step: string;
}

export function LockedTab({ title, description, step }: LockedTabProps) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-card-elevated">
        <span className="font-mono text-xs text-muted-foreground">{step}</span>
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function WorkspaceSection({
  label,
  title,
  description,
  children,
  actions,
}: {
  label?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader label={label} title={title} description={description} className="mb-0" />
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
