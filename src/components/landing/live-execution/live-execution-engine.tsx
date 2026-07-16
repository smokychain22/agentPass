"use client";

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import {
  LIVE_EXECUTION_DEMO,
  LIVE_SEQUENCE_TIMINGS,
  LIVE_SEQUENCE_TOTAL_MS,
  pipelineStageForSequence,
  sequenceIndexAt,
  type LiveSequenceStage,
  type PipelineStageId,
} from "@/lib/demo/live-execution-demo";
import "./live-execution-engine.css";

const DEMO = LIVE_EXECUTION_DEMO;

const STAGE_HINTS: Record<LiveSequenceStage, string> = {
  connect: "Connect repository and pin the source commit for analysis.",
  findings: "Surface evidence-backed findings from the current commit.",
  contract: "Lock approved scope, allowed paths, and change budgets.",
  execute: "Apply bounded changes on an isolated task branch.",
  verify: "Run Twin Build Proof — original vs patched — independently.",
  deliver: "Return a review-ready Green PR with signed attestation.",
  pause: "Demonstration complete. Sequence will restart.",
};

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

function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

function severityTag(severity: string): string {
  if (severity === "safe") return "SAFE CANDIDATE";
  if (severity === "review") return "REVIEW FIRST";
  if (severity === "protected") return "PROTECTED";
  return "ANALYSIS";
}

export function LiveExecutionEngine() {
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const inView = useInView(rootRef);
  const hintId = useId();
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [heldPipeline, setHeldPipeline] = useState<PipelineStageId | null>(null);
  const [hoveredFinding, setHoveredFinding] = useState<string | null>(null);
  const elapsedRef = useRef(0);
  const lastIndexRef = useRef(-1);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    if (reducedMotion || paused || !inView) return;
    const started = performance.now() - elapsedRef.current;
    let frame = 0;
    const tick = (now: number) => {
      const next = (now - started) % LIVE_SEQUENCE_TOTAL_MS;
      elapsedRef.current = next;
      const index = sequenceIndexAt(next);
      // Re-render on stage change, or ~6fps during connect/findings for counters.
      const needsSmooth =
        index === 0 || index === 1 || index === 3 || index === 4;
      if (index !== lastIndexRef.current || (needsSmooth && Math.floor(next / 160) !== Math.floor((next - 16) / 160))) {
        lastIndexRef.current = index;
        setElapsed(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, paused, inView]);

  const sequenceIndex = reducedMotion
    ? LIVE_SEQUENCE_TIMINGS.length - 2
    : sequenceIndexAt(elapsed);
  const sequenceStage = LIVE_SEQUENCE_TIMINGS[sequenceIndex].stage;
  const activePipeline =
    heldPipeline ?? pipelineStageForSequence(sequenceStage);

  const filesCount = useMemo(() => {
    if (reducedMotion || sequenceIndex > 0) return DEMO.repository.filesAnalyzed;
    const connectMs = LIVE_SEQUENCE_TIMINGS[0].ms;
    const progress = Math.min(1, elapsed / connectMs);
    return Math.round(DEMO.repository.filesAnalyzed * progress);
  }, [elapsed, reducedMotion, sequenceIndex]);

  const visibleFindingCount = useMemo(() => {
    if (reducedMotion || sequenceIndex >= 2) return DEMO.findings.length;
    if (sequenceIndex < 1) return 0;
    const findingsMs = LIVE_SEQUENCE_TIMINGS[1].ms;
    const local =
      elapsed - LIVE_SEQUENCE_TIMINGS[0].ms;
    const step = findingsMs / DEMO.findings.length;
    return Math.min(DEMO.findings.length, Math.floor(local / step) + 1);
  }, [elapsed, reducedMotion, sequenceIndex]);

  const showContract =
    reducedMotion || sequenceIndex >= 2 || activePipeline === "contract";
  const showExecute =
    reducedMotion || sequenceIndex >= 3 || activePipeline === "execute";
  const showVerify =
    reducedMotion || sequenceIndex >= 4 || activePipeline === "verify";
  const showDeliver =
    reducedMotion || sequenceIndex >= 5 || activePipeline === "deliver";

  const progressStates = DEMO.execution.progress.map((label, index) => {
    if (!showExecute) return "pending";
    if (sequenceIndex > 3 || reducedMotion) return "passed";
    const local =
      elapsed -
      LIVE_SEQUENCE_TIMINGS[0].ms -
      LIVE_SEQUENCE_TIMINGS[1].ms -
      LIVE_SEQUENCE_TIMINGS[2].ms;
    const step = LIVE_SEQUENCE_TIMINGS[3].ms / DEMO.execution.progress.length;
    const reached = Math.floor(local / step);
    if (index < reached) return "passed";
    if (index === reached) return "running";
    return "pending";
  });

  const twinOnCount = useMemo(() => {
    if (!showVerify) return 0;
    if (sequenceIndex > 4 || reducedMotion) return DEMO.twinBuild.checks.length;
    const local =
      elapsed -
      LIVE_SEQUENCE_TIMINGS.slice(0, 4).reduce((s, e) => s + e.ms, 0);
    const step = LIVE_SEQUENCE_TIMINGS[4].ms / DEMO.twinBuild.checks.length;
    return Math.min(DEMO.twinBuild.checks.length, Math.floor(local / step) + 1);
  }, [elapsed, reducedMotion, sequenceIndex, showVerify]);

  const pipelineIndex = DEMO.pipeline.findIndex((p) => p.id === activePipeline);
  const hint = STAGE_HINTS[sequenceStage];

  const jumpToPipeline = (id: PipelineStageId) => {
    setHeldPipeline(id);
    setPaused(true);
    const targetStage =
      id === "analyze"
        ? "findings"
        : id === "contract"
          ? "contract"
          : id === "execute"
            ? "execute"
            : id === "verify"
              ? "verify"
              : "deliver";
    let offset = 0;
    for (const entry of LIVE_SEQUENCE_TIMINGS) {
      if (entry.stage === targetStage) {
        setElapsed(offset + 50);
        break;
      }
      offset += entry.ms;
    }
  };

  const play = () => {
    setHeldPipeline(null);
    setPaused(false);
  };

  return (
    <section
      ref={rootRef}
      className={`lee${paused || hoveredFinding ? " is-paused" : ""}`}
      data-stage={sequenceStage}
      aria-label="RepoDiet Live Execution Engine — demonstration data"
      aria-describedby={hintId}
    >
      <div className="lee__scan" aria-hidden="true" />

      <header className="lee__header">
        <div>
          <p className="lee__title">{DEMO.engineTitle}</p>
          <p className="lee__contract-meta">{DEMO.maintenanceLabel}</p>
        </div>
        <div className="lee__badges">
          <span className="lee__badge">{DEMO.liveBadge}</span>
          <span className="lee__badge lee__badge--demo">{DEMO.label}</span>
        </div>
      </header>

      <div className="lee__body">
        {/* Findings */}
        <div className="lee__col">
          <p className="lee__col-label">Repository Findings</p>
          <div className="lee__repo-meta">
            <div>
              Repository: <strong>{DEMO.repository.fullName}</strong>
            </div>
            <div>
              Branch: <strong>{DEMO.repository.branch}</strong>
            </div>
            <div>
              Source: <strong>{DEMO.repository.sourceCommit}</strong>
            </div>
            <div>
              Root: <strong>{DEMO.repository.projectRoot}</strong>
            </div>
          </div>
          <p className="lee__files-count">Files analyzed: {filesCount}</p>
          <div className="lee__findings" role="list">
            {DEMO.findings.map((finding, index) => {
              const visible = index < visibleFindingCount;
              const hovered = hoveredFinding === finding.id;
              return (
                <button
                  key={finding.id}
                  type="button"
                  role="listitem"
                  className={`lee__finding${visible ? " is-visible" : ""}${
                    finding.selected && showContract ? " is-selected" : ""
                  }${finding.severity === "protected" ? " is-protected" : ""}${
                    hovered ? " is-hovered" : ""
                  }`}
                  style={{ transitionDelay: `${index * 40}ms` }}
                  onMouseEnter={() => {
                    setHoveredFinding(finding.id);
                    setPaused(true);
                  }}
                  onMouseLeave={() => {
                    setHoveredFinding(null);
                    if (!heldPipeline) setPaused(false);
                  }}
                  onFocus={() => {
                    setHoveredFinding(finding.id);
                    setPaused(true);
                  }}
                  onBlur={() => {
                    setHoveredFinding(null);
                    if (!heldPipeline) setPaused(false);
                  }}
                  aria-label={`${finding.path}. ${finding.category}. ${severityTag(finding.severity)}`}
                >
                  <div className="lee__finding-top">
                    <span className="lee__finding-path">{finding.path}</span>
                    <span className={`lee__tag lee__tag--${finding.severity}`}>
                      {severityTag(finding.severity)}
                    </span>
                  </div>
                  <span className="lee__finding-cat">{finding.category}</span>
                  <ul className="lee__finding-evidence">
                    {finding.evidence.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pipeline */}
        <div className="lee__col">
          <p className="lee__col-label">Execution Pipeline</p>
          <div className="lee__pipeline" role="list">
            {DEMO.pipeline.map((stage, index) => {
              const isActive = activePipeline === stage.id;
              const isDone = pipelineIndex > index && !heldPipeline;
              return (
                <button
                  key={stage.id}
                  type="button"
                  role="listitem"
                  className={`lee__stage${isActive ? " is-active" : ""}${
                    isDone ? " is-done" : ""
                  }`}
                  onClick={() => jumpToPipeline(stage.id)}
                  aria-pressed={isActive}
                  aria-label={`${stage.number} ${stage.label}`}
                >
                  <span className="lee__stage-node" aria-hidden="true" />
                  <span>
                    {stage.number} {stage.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Output */}
        <div className="lee__col">
          <p className="lee__col-label">Verified Output</p>
          <div className="lee__output">
            <div
              className={`lee__panel${showContract ? " is-visible" : ""}`}
              aria-hidden={!showContract}
            >
              <p className="lee__panel-title">Maintenance Contract</p>
              <p className="lee__lock">
                <span className="lee__lock-icon" aria-hidden="true" />
                SCOPE LOCKED · {DEMO.contractId}
              </p>
              <div className="lee__meta-grid" style={{ marginTop: "0.4rem" }}>
                <div>
                  <span>Source </span>
                  {DEMO.repository.sourceCommit}
                </div>
                <div>
                  <span>Selected </span>
                  {DEMO.contract.selectedFindings} findings
                </div>
                <div>
                  <span>Budget </span>
                  {DEMO.contract.changeBudget.files} files ·{" "}
                  {DEMO.contract.changeBudget.lines} lines
                </div>
                <div>
                  <span>Protected </span>
                  {DEMO.contract.protectedPaths.join(", ")}
                </div>
              </div>
            </div>

            <div
              className={`lee__panel${showExecute ? " is-visible" : ""}`}
              aria-hidden={!showExecute}
            >
              <p className="lee__panel-title">Bounded Execution</p>
              <div className="lee__diff">
                {DEMO.execution.diffs.map((diff) => (
                  <div key={diff.path} style={{ marginBottom: "0.25rem" }}>
                    {diff.before ? (
                      <div className="lee__diff-del">- {diff.before}</div>
                    ) : null}
                    {diff.after ? (
                      <div className="lee__diff-add">+ {diff.after}</div>
                    ) : (
                      <div className="lee__diff-del">
                        Deleted: {diff.path}
                        {diff.kind === "dependency" ? " (dependency)" : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="lee__progress">
                {DEMO.execution.progress.map((label, index) => (
                  <div
                    key={label}
                    className={`lee__progress-item is-${progressStates[index]}`}
                  >
                    <span className="lee__progress-dot" aria-hidden="true" />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div
              className={`lee__panel${showVerify ? " is-visible" : ""}`}
              aria-hidden={!showVerify}
            >
              <p className="lee__panel-title is-emerald">{DEMO.twinBuild.title}</p>
              <div className="lee__twin">
                <div className="lee__twin-col">
                  <div className="lee__twin-label">Original</div>
                  {DEMO.twinBuild.checks.map((check, index) => (
                    <div
                      key={check.id}
                      className={`lee__twin-row${index < twinOnCount ? " is-on" : ""}`}
                    >
                      <span>{check.label}</span>
                      <span>{check.original}</span>
                    </div>
                  ))}
                </div>
                <div className="lee__twin-col">
                  <div className="lee__twin-label">Patched</div>
                  {DEMO.twinBuild.checks.map((check, index) => (
                    <div
                      key={check.id}
                      className={`lee__twin-row${index < twinOnCount ? " is-on" : ""}`}
                    >
                      <span>{check.label}</span>
                      <span>{check.patched}</span>
                    </div>
                  ))}
                </div>
              </div>
              {(twinOnCount >= DEMO.twinBuild.checks.length || reducedMotion) && (
                <p className="lee__result">{DEMO.twinBuild.summary.result}</p>
              )}
            </div>

            <div
              className={`lee__panel${showDeliver ? " is-visible is-emphasis" : ""}`}
              aria-hidden={!showDeliver}
            >
              <p className="lee__panel-title is-emerald">{DEMO.delivery.title}</p>
              <p className="lee__delivery-title">Cleanup pull request {DEMO.delivery.prNumber}</p>
              <div className="lee__delivery-grid">
                <div>
                  Changed: <strong>{DEMO.delivery.changedFiles} files</strong>
                </div>
                <div>
                  Removed: <strong>{DEMO.delivery.removedLines} lines</strong>
                </div>
                <div>
                  Checks: <strong>{DEMO.delivery.requiredChecks}</strong>
                </div>
                <div>
                  Contract: <strong>{DEMO.delivery.contract}</strong>
                </div>
                <div>
                  Attestation: <strong>{DEMO.delivery.attestation}</strong>
                </div>
                <div>
                  Receipt: <strong>{DEMO.delivery.receipt}</strong>
                </div>
              </div>
              <p className="lee__seal">
                <span className="lee__seal-ring" aria-hidden="true" />
                Buyer recommendation: {DEMO.delivery.recommendation}
              </p>
              <div className="lee__actions" aria-hidden="true">
                <span className="lee__action">Open Pull Request</span>
                <span className="lee__action lee__action--ghost">Verify Proof</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="lee__footer">
        <p id={hintId} className="lee__hint" aria-live="polite">
          {hint}
        </p>
        <div className="lee__controls">
          <button
            type="button"
            className={`lee__control${paused ? " is-active" : ""}`}
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
          >
            {paused ? "Paused" : "Pause"}
          </button>
          <button type="button" className="lee__control" onClick={play}>
            Play live sequence
          </button>
        </div>
      </footer>
    </section>
  );
}
