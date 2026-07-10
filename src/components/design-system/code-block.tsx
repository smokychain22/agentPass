import { cn } from "@/lib/utils";

interface CodeBlockProps {
  children: string;
  title?: string;
  className?: string;
}

export function CodeBlock({ children, title, className }: CodeBlockProps) {
  return (
    <div className={cn("ds-card overflow-hidden rounded-lg", className)}>
      {title && (
        <div className="border-b border-border/60 bg-card-elevated px-4 py-2">
          <p className="ds-label">{title}</p>
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground scrollbar-thin sm:text-xs">
        <code>{children}</code>
      </pre>
    </div>
  );
}
