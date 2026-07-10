"use client";

import { useEffect, useState } from "react";
import { DEMO_TERMINAL_LINES } from "@/lib/marketing/content";

export function HeroTerminal() {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    if (visibleCount >= DEMO_TERMINAL_LINES.length) {
      const reset = setTimeout(() => setVisibleCount(1), 4000);
      return () => clearTimeout(reset);
    }
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), 420);
    return () => clearTimeout(timer);
  }, [visibleCount]);

  return (
    <div className="rounded-lg border border-border bg-card/80 shadow-[0_0_0_1px_hsl(var(--border))]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-signal/70" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          DEMO SCAN PREVIEW
        </span>
      </div>
      <pre className="min-h-[280px] overflow-hidden p-5 font-mono text-xs leading-relaxed sm:text-sm">
        <code>
          {DEMO_TERMINAL_LINES.slice(0, visibleCount).map((line, i) => (
            <span key={i} className="block">
              {line.text ? (
                <>
                  {line.text.startsWith("$") ? (
                    <>
                      <span className="text-muted-foreground">$</span>
                      <span className="text-foreground">{line.text.slice(1)}</span>
                    </>
                  ) : line.text.includes(":") ? (
                    <>
                      <span className="text-electric">{line.text.split(":")[0]}:</span>
                      <span className="text-foreground">
                        {line.text.slice(line.text.indexOf(":") + 1)}
                      </span>
                    </>
                  ) : (
                    <span className={line.className || "text-muted-foreground"}>{line.text}</span>
                  )}
                </>
              ) : (
                "\u00a0"
              )}
            </span>
          ))}
          <span className="inline-block w-2 h-4 bg-electric/80 animate-pulse ml-0.5 align-middle" />
        </code>
      </pre>
      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground font-mono">
        Illustrative preview — numbers update when demo repo is wired to live scan.
      </p>
    </div>
  );
}
