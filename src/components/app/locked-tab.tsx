import { ReactNode } from "react";

interface LockedTabProps {
  title: string;
  description: string;
  step: string;
}

export function LockedTab({ title, description, step }: LockedTabProps) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted">
        <span className="font-mono text-xs text-muted-foreground">{step}</span>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle: string;
  badge?: ReactNode;
}

export function PageHeader({ title, subtitle, badge }: PageHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {badge}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
        {subtitle}
      </p>
    </div>
  );
}
