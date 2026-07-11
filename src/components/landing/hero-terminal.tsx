"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { DEMO_SCAN_STATS } from "@/lib/marketing/content";

const COMMAND = "$ repodiet scan repodiet-demo-slop-app";

type ResultRow = {
  label: string;
  value: string;
  done: boolean;
};

function buildResults(): ResultRow[] {
  const s = DEMO_SCAN_STATS;
  return [
    { label: "framework", value: s.framework, done: true },
    { label: "files indexed", value: String(s.filesIndexed), done: true },
    {
      label: "duplicate logic",
      value: `${s.duplicateClusters} clusters`,
      done: true,
    },
    { label: "risk buckets", value: "ready", done: true },
    { label: "patch bundle", value: s.patchBundleReady ? "generated" : "pending", done: s.patchBundleReady },
  ];
}

const FILE_TREE = [
  "components/",
  "  Button.tsx",
  "  ButtonFinal.tsx",
  "  ButtonCopy.tsx",
  "archive/",
  "  OldDashboard.tsx",
  "lib/utils-old.ts",
];

export function HeroTerminal() {
  const [phase, setPhase] = useState(0);
  const results = buildResults();
  const visibleResults = results.slice(0, Math.max(0, phase - 1));
  const showCommand = phase >= 1;
  const showTree = phase >= 2;

  useEffect(() => {
    const maxPhase = results.length + 2;
    if (phase >= maxPhase) {
      const reset = setTimeout(() => setPhase(0), 4500);
      return () => clearTimeout(reset);
    }
    const timer = setTimeout(() => setPhase((p) => p + 1), phase === 0 ? 600 : 480);
    return () => clearTimeout(timer);
  }, [phase, results.length]);

  return (
    <div className="mcc-panel-elevated relative overflow-hidden rounded-lg shadow-mcc-glow">
      <div className="terminal-scanline" aria-hidden />

      {/* Title bar */}
      <div className="flex items-center justify-between gap-2 border-b mcc-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-danger/80" />
          <span className="h-2 w-2 rounded-full bg-warning/80" />
          <span className="h-2 w-2 rounded-full bg-signal/80" />
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border mcc-border bg-[#05070A] px-2 py-0.5 font-mono text-[9px] text-signal">
            live
          </span>
          <span className="mono-label">demo scan</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_200px]">
        {/* Left: command + output */}
        <div className="relative border-b mcc-border p-4 font-mono text-xs leading-relaxed sm:p-5 sm:text-sm lg:border-b-0 lg:border-r">
          {showCommand && (
            <p className="text-[#F8FAFC]">
              <span className="text-[#64748B]">$</span> repodiet scan{" "}
              <span className="text-electric">repodiet-demo-slop-app</span>
            </p>
          )}

          {showTree && (
            <div className="mt-4 rounded border mcc-border bg-[#05070A]/60 p-3">
              <p className="mono-label mb-2 text-[9px]">file tree</p>
              {FILE_TREE.map((line, i) => (
                <p
                  key={line}
                  className="text-[10px] text-[#64748B] transition-opacity duration-300"
                  style={{ opacity: phase > i + 2 ? 1 : 0.3 }}
                >
                  {line}
                </p>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-1">
            {visibleResults.map((row) => (
              <p key={row.label} className="flex gap-2 text-secondary">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
                <span>
                  <span className="text-electric">{row.label}</span>
                  <span className="text-[#64748B]">{"  "}</span>
                  <span className="text-[#F8FAFC]">{row.value}</span>
                </span>
              </p>
            ))}
          </div>

          <span className="mt-2 inline-block h-4 w-2 animate-cursor-blink bg-electric align-middle" />
        </div>

        {/* Right: results stack */}
        <div className="bg-[#05070A]/40 p-4">
          <p className="mono-label mb-3">Patch bundle</p>
          <div className="space-y-2">
            {results.map((row, i) => {
              const visible = phase > i + 1;
              return (
                <div
                  key={row.label}
                  className="rounded border mcc-border bg-[#0C1118] px-2.5 py-2 transition-opacity duration-300"
                  style={{ opacity: visible ? 1 : 0.25 }}
                >
                  <div className="flex items-center gap-1.5">
                    {visible && row.done ? (
                      <Check className="h-3 w-3 text-signal" />
                    ) : (
                      <span className="h-3 w-3 rounded-full border mcc-border" />
                    )}
                    <span className="font-mono text-[10px] text-[#F8FAFC]">{row.label}</span>
                  </div>
                  <p className="mt-0.5 pl-[18px] font-mono text-[10px] text-secondary">
                    {visible ? row.value : "—"}
                  </p>
                </div>
              );
            })}
          </div>
          {phase > results.length && (
            <div className="mt-3 rounded border border-signal/25 bg-signal/5 px-2.5 py-2">
              <p className="font-mono text-[10px] font-medium text-signal">ready</p>
              <p className="font-mono text-[9px] text-secondary">7 artifacts</p>
            </div>
          )}
        </div>
      </div>

      <p className="border-t mcc-border px-4 py-2 font-mono text-[10px] text-[#64748B]">
        Live output from messy demo repo — {COMMAND.replace("$ ", "")}
      </p>
    </div>
  );
}
