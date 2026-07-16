"use client";

import { useEffect, useId, useState } from "react";
import "./delivery-engine.css";

type StageId = "analyze" | "approve" | "execute" | "verify" | "deliver";

type EngineStage = {
  id: StageId;
  label: string;
  hint: string;
  /** Animation stages (0–7) where this rail stage is considered active. */
  activeWhen: number[];
};

const STAGES: EngineStage[] = [
  {
    id: "analyze",
    label: "Analyze",
    hint: "Find evidence from the repository’s current commit.",
    activeWhen: [0, 1],
  },
  {
    id: "approve",
    label: "Approve",
    hint: "The buyer decides exactly what RepoDiet may change.",
    activeWhen: [2, 3],
  },
  {
    id: "execute",
    label: "Execute",
    hint: "Changes run on an isolated task branch.",
    activeWhen: [4],
  },
  {
    id: "verify",
    label: "Verify",
    hint: "Scope, checks and protected paths are independently validated.",
    activeWhen: [5],
  },
  {
    id: "deliver",
    label: "Deliver",
    hint: "A real pull request is returned for buyer review.",
    activeWhen: [6, 7],
  },
];

const TREE_ROWS = [
  { name: "src/", marker: null as string | null },
  { name: "components/", marker: "unused" },
  { name: "legacy/", marker: "duplicate" },
  { name: "package.json", marker: "dependency" },
  { name: "tests/", marker: null },
  { name: "auth/", marker: "protected" },
] as const;

const APPROVED = [
  "remove unused import",
  "delete verified temp file",
  "remove unused dependency",
];

const PROTECTED = ["auth", "environment configuration", "database migrations"];

const PR_STATES = [
  "Approved scope applied",
  "Protected paths unchanged",
  "Repository checks completed",
  "Buyer decision required",
];

const CHECKS = ["Scope", "Build", "Tests", "Protected paths"] as const;

const STAGE_COUNT = 8;
const STAGE_MS = 1100;
const FINAL_STAGE = 7;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

function stageIndexForPhase(phase: StageId): number {
  return STAGES.findIndex((entry) => entry.id === phase);
}

export function DeliveryEngine() {
  const reducedMotion = usePrefersReducedMotion();
  const hintId = useId();
  const [stage, setStage] = useState(0);
  const [hovered, setHovered] = useState<StageId | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reducedMotion || paused) return;
    const id = window.setInterval(() => {
      setStage((current) => (current + 1) % STAGE_COUNT);
    }, STAGE_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, paused]);

  const displayStage = reducedMotion ? FINAL_STAGE : stage;
  const activePhase =
    STAGES.find((entry) => entry.activeWhen.includes(displayStage))?.id ?? "analyze";
  const effectivePhase = hovered ?? activePhase;
  const hint = STAGES.find((entry) => entry.id === effectivePhase)?.hint ?? STAGES[0].hint;
  const activeRailIndex = stageIndexForPhase(effectivePhase);

  return (
    <section
      className={`de-engine${paused || hovered ? " is-paused" : ""}`}
      data-stage={String(displayStage)}
      aria-label="RepoDiet Delivery Engine — illustrative product workflow"
      aria-describedby={hintId}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setHovered(null);
      }}
    >
      <div className="de-engine__glow" aria-hidden="true" />

      <header className="de-engine__header">
        <div>
          <p className="de-zone__label" style={{ marginBottom: "0.2rem" }}>
            RepoDiet Delivery Engine
          </p>
          <p
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              fontSize: "11px",
              color: "rgba(230, 236, 245, 0.78)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "0.4rem",
                height: "0.4rem",
                borderRadius: "999px",
                background: "var(--de-green)",
                boxShadow: "0 0 8px rgba(32, 230, 168, 0.45)",
              }}
            />
            Buyer controlled
          </p>
        </div>
        <p
          style={{
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            fontSize: "10px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(155, 170, 194, 0.75)",
            textAlign: "right",
          }}
        >
          Illustrative product workflow
        </p>
      </header>

      <div className="de-pipeline" role="list" aria-label="Delivery stages">
        {STAGES.map((entry, index) => {
          const isActive = effectivePhase === entry.id;
          const isDone = activeRailIndex > index && !hovered;
          return (
            <div key={entry.id} style={{ display: "contents" }}>
              {index > 0 ? (
                <div
                  className={`de-connector${displayStage >= entry.activeWhen[0] || reducedMotion ? " is-lit" : ""}`}
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                role="listitem"
                className={`de-stage${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}`}
                onMouseEnter={() => setHovered(entry.id)}
                onFocus={() => {
                  setPaused(true);
                  setHovered(entry.id);
                }}
                onBlur={() => {
                  setPaused(false);
                  setHovered(null);
                }}
                aria-pressed={isActive}
                aria-label={`${entry.label}. ${entry.hint}`}
              >
                <span className="de-stage__node" aria-hidden="true" />
                <span className="de-stage__name">{entry.label}</span>
                {hovered === entry.id ? (
                  <span className="de-tooltip" role="tooltip">
                    {entry.hint}
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>

      <div className="de-engine__canvas">
        {/* LEFT — Repository Intelligence */}
        <div
          className={`de-zone${effectivePhase === "analyze" ? " is-active" : ""}`}
          data-zone="repository"
        >
          <p className="de-zone__label">Repository Intelligence</p>
          <div className="de-tree" aria-hidden="true">
            <div className="de-tree__scan" />
            {TREE_ROWS.map((row) => {
              const isProtected = row.marker === "protected";
              return (
                <div
                  key={row.name}
                  className={`de-file${row.marker ? " is-marked" : ""}${
                    isProtected ? " is-protected" : ""
                  }`}
                >
                  <span>{row.name}</span>
                  {row.marker ? (
                    <span className={`de-marker de-marker--${row.marker}`}>{row.marker}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="de-sr-only">
            Illustrative repository tree with evidence markers for unused code, duplicates,
            dependencies, and protected paths.
          </p>
          <div className="de-packets" aria-hidden="true">
            <span className="de-packet" />
            <span className="de-packet" />
            <span className="de-packet de-packet--blocked" />
          </div>
        </div>

        {/* CENTER — Scope boundary */}
        <div
          className={`de-zone de-scope${
            effectivePhase === "approve" || displayStage >= 2 ? " is-active" : ""
          }`}
          data-zone="scope"
        >
          <p className="de-zone__label">Scope &amp; execution boundary</p>
          <div className="de-scope__gate">
            <p className="de-scope__title">Approved</p>
            <ul className="de-chip-list">
              {APPROVED.map((item) => (
                <li key={item} className="de-chip de-chip--approved">
                  <span className="de-chip__dot" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="de-protected">
            <p className="de-protected__title">
              <span aria-hidden="true">▣</span> Protected · blocked
            </p>
            <ul className="de-chip-list">
              {PROTECTED.map((item) => (
                <li key={item} className="de-chip" style={{ opacity: 0.85, transform: "none" }}>
                  <span
                    className="de-chip__dot"
                    aria-hidden="true"
                    style={{ background: "var(--de-amber)" }}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <p className="de-sr-only">Only approved changes pass. Protected paths are blocked.</p>
        </div>

        {/* RIGHT — Verified PR */}
        <div
          className={`de-zone de-zone--pr${
            displayStage >= 6 || reducedMotion ? " is-verified" : ""
          }${effectivePhase === "deliver" ? " is-active" : ""}`}
          data-zone="deliver"
        >
          <div className="de-pr">
            <p className="de-zone__label">Review Pull Request</p>
            <p className="de-pr__status">
              <span className="de-pr__status-dot" aria-hidden="true" />
              Ready for review
            </p>
            <p className="de-pr__title">Cleanup pull request</p>
            <ul className="de-pr__list">
              {PR_STATES.map((item, index) => (
                <li
                  key={item}
                  className="de-pr__item"
                  style={
                    index === PR_STATES.length - 1
                      ? { color: "rgba(245, 185, 66, 0.95)" }
                      : undefined
                  }
                >
                  <span className="de-pr__item-mark" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="de-pr__cta" aria-hidden="true">
              Review Pull Request →
            </div>
          </div>
        </div>
      </div>

      {/* Execution + verification strip under the three zones */}
      <div className="de-checks" aria-label="Verification checks">
        <span
          style={{
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            fontSize: "10px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(155, 170, 194, 0.7)",
            alignSelf: "center",
            marginRight: "0.25rem",
          }}
        >
          Isolated branch
        </span>
        {CHECKS.map((check, index) => {
          const isOn =
            reducedMotion || displayStage >= 6 || (displayStage === 5 && index <= 3);
          return (
            <span key={check} className={`de-check${isOn && displayStage >= 5 ? " is-on" : ""}`}>
              <span className="de-check__dot" aria-hidden="true" />
              {check}
            </span>
          );
        })}
      </div>

      <footer className="de-footer">
        <p id={hintId} className="de-hint">
          {hint}
        </p>
        <div className="de-proto" aria-label="Protocol labels">
          <span>A2MCP · Repository analysis</span>
          <span>A2A · Cleanup PR delivery</span>
        </div>
      </footer>
      <p className="de-engine__tagline">
        Analysis discovers the work. A2A delivers the approved result.
      </p>
    </section>
  );
}
