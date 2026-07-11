import { cn } from "@/lib/utils";

interface DiffViewerProps {
  content: string;
  className?: string;
}

export function DiffViewer({ content, className }: DiffViewerProps) {
  const lines = content.split("\n");

  return (
    <pre
      className={cn(
        "overflow-auto p-4 font-mono text-[11px] leading-relaxed scrollbar-thin",
        className
      )}
    >
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isRemove = line.startsWith("-") && !line.startsWith("---");
        const isHeader = line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@");
        const isComment = line.startsWith("#");

        return (
          <div
            key={`${i}-${line.slice(0, 12)}`}
            className={cn(
              "flex gap-3 px-1",
              isAdd && "bg-signal/10 text-signal",
              isRemove && "bg-danger/10 text-danger",
              isHeader && "text-electric",
              isComment && "text-muted-foreground",
              !isAdd && !isRemove && !isHeader && !isComment && "text-muted-foreground"
            )}
          >
            <span className="w-6 shrink-0 select-none text-right text-muted-foreground/40">
              {i + 1}
            </span>
            <code className="flex-1 whitespace-pre-wrap break-all">{line || " "}</code>
          </div>
        );
      })}
    </pre>
  );
}
