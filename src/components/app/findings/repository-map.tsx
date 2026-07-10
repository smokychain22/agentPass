import type { Finding } from "@/lib/findings/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";

interface RepositoryMapProps {
  findings: Finding[];
}

interface MapNode {
  id: string;
  label: string;
  level: "safe" | "review" | "protected" | "danger" | "neutral";
  x: number;
  y: number;
}

function buildNodes(findings: Finding[]): MapNode[] {
  const paths = new Set<string>();
  paths.add("repo/");

  for (const f of findings) {
    for (const file of f.files.slice(0, 1)) {
      const parts = file.split("/");
      if (parts.length > 1) paths.add(`${parts[0]}/`);
      paths.add(file.length > 24 ? `${file.slice(0, 22)}…` : file);
    }
    if (f.packageName) paths.add(f.packageName);
  }

  const items = [...paths].slice(0, 12);
  const cols = 4;
  return items.map((label, i) => {
    const finding = findings.find((f) => f.files.some((file) => file.includes(label.replace("…", ""))) || f.packageName === label);
    const level =
      finding?.action === "safe_candidate"
        ? "safe"
        : finding?.action === "do_not_touch"
          ? "protected"
          : finding?.type === "orphan_pattern"
            ? "danger"
            : finding
              ? "review"
              : "neutral";

    return {
      id: `${label}-${i}`,
      label,
      level,
      x: 40 + (i % cols) * 72,
      y: 36 + Math.floor(i / cols) * 48,
    };
  });
}

export function RepositoryMap({ findings }: RepositoryMapProps) {
  const nodes = buildNodes(findings);

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

      <svg viewBox="0 0 320 200" className="w-full rounded border border-border/40 bg-[#05080D]/50" role="img" aria-label="Repository structure map">
        <line x1="160" y1="20" x2="160" y2="180" stroke="currentColor" strokeOpacity="0.08" />
        {nodes.map((node, i) => {
          if (i === 0) return null;
          return (
            <line
              key={`line-${node.id}`}
              x1={nodes[0].x + 24}
              y1={nodes[0].y + 12}
              x2={node.x + 24}
              y2={node.y + 12}
              stroke="currentColor"
              strokeOpacity="0.12"
            />
          );
        })}
        {nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width="48"
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
              strokeOpacity="0.5"
            />
            <text
              x={node.x + 24}
              y={node.y + 15}
              textAnchor="middle"
              fill="currentColor"
              fontSize="6"
              fontFamily="monospace"
            >
              {node.label.length > 10 ? `${node.label.slice(0, 9)}…` : node.label}
            </text>
          </g>
        ))}
      </svg>

      {/* Keyboard-accessible fallback list */}
      <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto scrollbar-thin lg:hidden">
        {nodes.map((node) => (
          <li key={`list-${node.id}`} className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>{node.label}</span>
            <RiskBadge level={node.level}>{node.level}</RiskBadge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
