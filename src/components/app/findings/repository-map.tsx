"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/findings/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";

interface RepositoryMapProps {
  findings: Finding[];
  onSelectFinding?: (findingId: string) => void;
}

interface MapNode {
  id: string;
  label: string;
  fullPath: string;
  findingId?: string;
  level: "safe" | "review" | "protected" | "danger" | "neutral";
  x: number;
  y: number;
}

const MAX_NODES = 16;

function buildNodes(findings: Finding[]): MapNode[] {
  const nodes: MapNode[] = [
    { id: "root", label: "repository", fullPath: "/", level: "neutral", x: 140, y: 16 },
  ];
  const seen = new Set<string>();

  for (const finding of findings) {
    for (const file of finding.files) {
      if (seen.has(file) || nodes.length >= MAX_NODES) continue;
      seen.add(file);
      const parts = file.split("/");
      const label = parts.length > 2 ? `${parts[0]}/${parts[1]}` : file;
      nodes.push({
        id: file,
        label: label.length > 28 ? `${label.slice(0, 26)}…` : label,
        fullPath: file,
        findingId: finding.id,
        level:
          finding.action === "safe_candidate"
            ? "safe"
            : finding.action === "do_not_touch"
              ? "protected"
              : finding.type === "orphan_pattern"
                ? "danger"
                : "review",
        x: 24 + ((nodes.length - 1) % 4) * 72,
        y: 56 + Math.floor((nodes.length - 1) / 4) * 44,
      });
    }
  }

  return nodes;
}

export function RepositoryMap({ findings, onSelectFinding }: RepositoryMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const nodes = useMemo(() => buildNodes(findings), [findings]);

  return (
    <Panel variant="elevated" padding="md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="ds-label">Repository map</p>
        <div className="flex flex-wrap gap-2">
          <RiskBadge level="safe">Safe</RiskBadge>
          <RiskBadge level="review">Review</RiskBadge>
          <RiskBadge level="protected">Protected</RiskBadge>
          <RiskBadge level="danger">Orphan</RiskBadge>
        </div>
      </div>

      <svg
        viewBox="0 0 320 220"
        className="w-full rounded border border-border/40 bg-[#05080D]/50"
        role="img"
        aria-label="Repository structure map"
      >
        {nodes.slice(1).map((node) => (
          <line
            key={`line-${node.id}`}
            x1={nodes[0].x + 40}
            y1={nodes[0].y + 12}
            x2={node.x + 40}
            y2={node.y + 12}
            stroke="currentColor"
            strokeOpacity="0.12"
          />
        ))}
        {nodes.map((node) => (
          <g
            key={node.id}
            onMouseEnter={() => setHovered(node.fullPath)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => node.findingId && onSelectFinding?.(node.findingId)}
            style={{ cursor: node.findingId ? "pointer" : "default" }}
          >
            <title>{node.fullPath}</title>
            <rect
              x={node.x}
              y={node.y}
              width="80"
              height="24"
              rx="4"
              fill="#0B111A"
              stroke={
                node.level === "safe"
                  ? "#20E6A8"
                  : node.level === "review"
                    ? "#F5B942"
                    : node.level === "protected"
                      ? "#6F7E93"
                      : node.level === "danger"
                        ? "#FF5C6C"
                        : "#18BFFF"
              }
              strokeOpacity={hovered === node.fullPath ? 1 : 0.5}
            />
            <text
              x={node.x + 40}
              y={node.y + 15}
              textAnchor="middle"
              fill="currentColor"
              fontSize="6"
              fontFamily="monospace"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>

      {hovered && (
        <p className="mt-2 font-mono text-[10px] text-electric/90">{hovered}</p>
      )}

      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto scrollbar-thin">
        {nodes.slice(1).map((node) => (
          <li key={`list-${node.id}`}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left font-mono text-[10px] text-muted-foreground hover:bg-card-elevated hover:text-foreground"
              onClick={() => node.findingId && onSelectFinding?.(node.findingId)}
            >
              <span className="truncate">{node.fullPath}</span>
              <RiskBadge level={node.level}>{node.level}</RiskBadge>
            </button>
          </li>
        ))}
      </ul>
      {findings.length > MAX_NODES && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Showing {MAX_NODES - 1} of {findings.length} mapped paths. Use the findings list for full coverage.
        </p>
      )}
    </Panel>
  );
}
