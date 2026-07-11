import { Shield } from "lucide-react";
import { Panel } from "@/components/design-system/panel";

const CHECKS = [
  "Repository structure",
  "Duplicate logic",
  "Dead files",
  "Dependencies",
  "Orphan modules",
  "Cleanup risk",
] as const;

const FRAMEWORKS = ["Next.js", "React", "Vite", "Remix", "Astro", "Node/Express"] as const;

export function ScanEmptyIllustration() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel variant="elevated" padding="md" className="relative overflow-hidden">
        <p className="ds-label mb-4">Repository topology</p>
        <svg viewBox="0 0 320 200" className="w-full text-muted-foreground" aria-hidden>
          <line x1="160" y1="30" x2="80" y2="80" stroke="currentColor" strokeOpacity="0.2" />
          <line x1="160" y1="30" x2="240" y2="80" stroke="currentColor" strokeOpacity="0.2" />
          <line x1="80" y1="80" x2="50" y2="140" stroke="currentColor" strokeOpacity="0.15" />
          <line x1="80" y1="80" x2="110" y2="140" stroke="currentColor" strokeOpacity="0.15" />
          <line x1="240" y1="80" x2="210" y2="140" stroke="currentColor" strokeOpacity="0.15" />
          <line x1="240" y1="80" x2="270" y2="140" stroke="currentColor" strokeOpacity="0.15" />
          <line x1="160" y1="30" x2="160" y2="170" stroke="#18BFFF" strokeOpacity="0.4" strokeDasharray="4 3" />
          <circle cx="160" cy="30" r="14" fill="#101923" stroke="#18BFFF" strokeOpacity="0.5" />
          <text x="160" y="34" textAnchor="middle" fill="#18BFFF" fontSize="8" fontFamily="monospace">
            repo/
          </text>
          {[
            [80, 80, "src/"],
            [240, 80, "lib/"],
            [50, 140, "pkg"],
            [110, 140, "routes"],
            [210, 140, "dup"],
            [270, 140, "dead"],
          ].map(([x, y, label]) => (
            <g key={String(label)}>
              <rect
                x={Number(x) - 22}
                y={Number(y) - 12}
                width="44"
                height="24"
                rx="4"
                fill="#0B111A"
                stroke="currentColor"
                strokeOpacity="0.25"
              />
              <text
                x={Number(x)}
                y={Number(y) + 4}
                textAnchor="middle"
                fill="currentColor"
                fontSize="7"
                fontFamily="monospace"
              >
                {label}
              </text>
            </g>
          ))}
          <circle cx="160" cy="170" r="12" fill="#20E6A820" stroke="#20E6A8" strokeOpacity="0.5" />
        </svg>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5 text-signal" aria-hidden />
          <span>Review-first · no repository mutation</span>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel variant="elevated" padding="md">
          <p className="ds-label mb-3">Supported frameworks</p>
          <div className="flex flex-wrap gap-1.5">
            {FRAMEWORKS.map((fw) => (
              <span
                key={fw}
                className="rounded border border-border/40 bg-[#05080D]/50 px-2 py-1 font-mono text-[10px] text-muted-foreground"
              >
                {fw}
              </span>
            ))}
          </div>
        </Panel>

        <Panel variant="elevated" padding="md">
          <p className="ds-label mb-3">What RepoDiet checks</p>
          <ul className="grid grid-cols-2 gap-2">
            {CHECKS.map((check) => (
              <li key={check} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-1 w-1 rounded-full bg-electric" aria-hidden />
                {check}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
