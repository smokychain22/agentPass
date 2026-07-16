"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/design-system/container";
import { DeliveryEngine } from "@/components/landing/delivery-engine/delivery-engine";
import { cn } from "@/lib/utils";

export function CredibilityStrip() {
  const items = [
    "Commit-pinned analysis",
    "Protected-path enforcement",
    "Independent verification",
    "Signed Green PR proof",
    "Buyer-controlled acceptance",
  ];
  return (
    <section className="border-y border-[rgba(139,164,190,0.2)] bg-[#08111A]/90">
      <Container className="py-4">
        <ul className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#8FA2B7]"
            >
              <span className="h-1 w-1 rounded-full bg-[#21D9A0]" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

export function ProblemDebtSection() {
  const commits = [
    { id: "021", debt: "+ duplicate helper" },
    { id: "034", debt: "+ abandoned page" },
    { id: "048", debt: "+ unused dependency" },
    { id: "063", debt: "+ temporary debug script" },
    { id: "079", debt: "+ conflicting API client" },
  ];
  return (
    <section id="product" className="py-14 sm:py-16">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
              The problem
            </p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
              AI makes code faster.
              <br />
              It also makes repository debt faster.
            </h2>
            <p className="mt-4 max-w-[650px] text-base leading-relaxed text-[#8FA2B7] sm:text-lg">
              Generated code often leaves duplicate implementations, abandoned files, dependency
              drift, temporary artifacts and conflicting patterns across a repository. Finding
              these problems is easy. Removing them safely is not.
            </p>
          </div>
          <div className="rounded-xl border border-[rgba(139,164,190,0.2)] bg-[#0B141E] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#66788D]">
              Repository Debt Accumulation
            </p>
            <ol className="mt-4 space-y-2">
              {commits.map((commit, index) => (
                <li
                  key={commit.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-[rgba(139,164,190,0.14)] bg-[#05090F]/60 px-3 py-2"
                  style={{ opacity: 0.55 + index * 0.09 }}
                >
                  <span className="font-mono text-[11px] text-[#8FA2B7]">Commit {commit.id}</span>
                  <span className="font-mono text-[11px] text-[#FF6378]">{commit.debt}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 rounded-md border border-[rgba(33,217,160,0.28)] bg-[rgba(33,217,160,0.06)] px-3 py-2.5">
              <p className="font-mono text-[11px] text-[#21D9A0]">
                RepoDiet locks one bounded maintenance contract and removes only verified
                candidates.
              </p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function AgentComparisonSection() {
  const rows = [
    ["Primary role", "Generate or modify code", "Deliver contracted repository maintenance"],
    ["Scope", "Prompt-defined", "Machine-readable locked contract"],
    ["Source binding", "May use current workspace", "Immutable source commit"],
    ["Execution authority", "Broad session access", "Allowed paths and operations only"],
    ["Verification", "Often self-reported", "Independent verifier"],
    ["Delivery", "Code or pull request", "Proof-carrying Green PR"],
    ["Acceptance", "Human reviews output", "Buyer agent can verify evidence"],
    ["Settlement", "Not inherent", "A2A acceptance-bound workflow"],
  ];
  return (
    <section className="border-y border-[rgba(139,164,190,0.2)] bg-[#08111A]/70 py-14 sm:py-16">
      <Container>
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
            Differentiation
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
            Coding agents generate changes.
            <br />
            RepoDiet governs maintenance delivery.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#8FA2B7] sm:text-lg">
            RepoDiet may use coding agents as workers while remaining the independent contract and
            verification layer.
          </p>
        </div>
        <div className="mt-8 overflow-x-auto rounded-xl border border-[rgba(139,164,190,0.2)]">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-[#0F1A25]">
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em] text-[#66788D]">
                  Dimension
                </th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em] text-[#8FA2B7]">
                  Coding Agent
                </th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em] text-[#20BFFF]">
                  RepoDiet
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([dimension, agent, repodiet]) => (
                <tr key={dimension} className="border-t border-[rgba(139,164,190,0.14)]">
                  <td className="px-4 py-3 font-medium text-[#F2F6FA]">{dimension}</td>
                  <td className="px-4 py-3 text-[#8FA2B7]">{agent}</td>
                  <td className="px-4 py-3 text-[#F2F6FA]">{repodiet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}

const PROTOCOL_STAGES = [
  {
    id: "analyze",
    title: "Analyze",
    summary: "Evidence-backed repository findings",
    artifact: "finding.json",
    detail:
      "RepoDiet binds analysis to the current source commit and classifies findings with static and dynamic evidence.",
  },
  {
    id: "approve",
    title: "Approve Scope",
    summary: "Selected findings, allowed paths, budgets and required checks",
    artifact: "repodiet.contract/v1",
    detail:
      "The buyer locks a machine-readable maintenance contract before any write operation begins.",
  },
  {
    id: "execute",
    title: "Execute",
    summary: "Isolated branch and bounded changes",
    artifact: "patch evidence",
    detail:
      "Approved changes run on an isolated task branch with path and change budgets enforced.",
  },
  {
    id: "verify",
    title: "Verify",
    summary: "Twin Build Proof and GitHub checks",
    artifact: "green-pr attestation",
    detail:
      "An independent verifier compares original and patched results and records attestation evidence.",
  },
  {
    id: "deliver",
    title: "Deliver",
    summary: "Green PR, attestation, receipt and acceptance recommendation",
    artifact: "signed receipt",
    detail:
      "Delivery returns a review-ready pull request with signed proof the buyer can verify before acceptance.",
  },
] as const;

export function GreenPrProtocolSection() {
  const [active, setActive] = useState<(typeof PROTOCOL_STAGES)[number]["id"]>("analyze");
  const stage = PROTOCOL_STAGES.find((entry) => entry.id === active) ?? PROTOCOL_STAGES[0];

  return (
    <section id="green-pr-protocol" className="py-14 sm:py-16">
      <Container>
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
            Green PR Protocol
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
            Every cleanup becomes a verifiable delivery contract.
          </h2>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Green PR stages">
              {PROTOCOL_STAGES.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active === entry.id}
                  className={cn(
                    "rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
                    active === entry.id
                      ? "border-[rgba(32,191,255,0.4)] bg-[rgba(32,191,255,0.1)] text-[#46D1FF]"
                      : "border-[rgba(139,164,190,0.2)] text-[#8FA2B7] hover:border-[rgba(32,191,255,0.3)]"
                  )}
                  onClick={() => setActive(entry.id)}
                >
                  {String(index + 1).padStart(2, "0")} {entry.title}
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-[rgba(139,164,190,0.2)] bg-[#0B141E] p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#20BFFF]">
                {stage.artifact}
              </p>
              <h3 className="mt-2 text-xl font-semibold text-[#F2F6FA]">{stage.title}</h3>
              <p className="mt-2 text-sm text-[#8FA2B7]">{stage.summary}</p>
              <p className="mt-3 text-sm leading-relaxed text-[#F2F6FA]/90">{stage.detail}</p>
            </div>
          </div>
          <div className="min-w-0">
            <DeliveryEngine />
          </div>
        </div>
      </Container>
    </section>
  );
}

export function LiveProofSection() {
  const fields = [
    ["Repository", "Sample proof · public demo repository"],
    ["Source commit", "Pinned at analysis time"],
    ["Contract digest", "repodiet.contract/v1"],
    ["Allowed paths", "Selected scope only"],
    ["Changed files", "Within change budget"],
    ["Build result", "Twin Build Proof"],
    ["Test result", "No new failures"],
    ["New diagnostics", "0"],
    ["GitHub PR", "Review-ready on isolated branch"],
    ["Attestation status", "Signed when delivery completes"],
    ["Receipt status", "Buyer-verifiable"],
    ["Acceptance recommendation", "Based on evidence gates"],
  ];
  return (
    <section id="proof" className="border-y border-[rgba(139,164,190,0.2)] bg-[#08111A]/70 py-14 sm:py-16">
      <Container>
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
            Live proof
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
            Do not trust a cleanup claim.
            <br />
            Verify it.
          </h2>
        </div>
        <div className="mt-8 rounded-xl border border-[rgba(139,164,190,0.2)] bg-[#0B141E] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#F3B942]">
              Sample proof
            </p>
            <p className="font-mono text-[11px] text-[#66788D]">
              Demonstration schema · not a live customer job
            </p>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([label, value]) => (
              <div
                key={label}
                className="rounded-md border border-[rgba(139,164,190,0.14)] bg-[#05090F]/50 px-3 py-2.5"
              >
                <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#66788D]">
                  {label}
                </dt>
                <dd className="mt-1 text-sm text-[#F2F6FA]">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/how-it-works">
                Verify Green PR <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/app">Open Pull Request flow</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/docs">View Contract docs</Link>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}

const CAPABILITIES = [
  {
    title: "Duplicate implementations",
    detects: "Near-identical components and helpers created instead of reuse.",
    evidence: "Structural similarity + reference graph",
    posture: "REVIEW FIRST",
    action: "Propose consolidation after buyer approval",
  },
  {
    title: "Dead files",
    detects: "Abandoned screens, backups, and unused modules.",
    evidence: "No supported static/dynamic references · not an entrypoint · not protected",
    posture: "SAFE CANDIDATE",
    action: "Delete in isolated branch",
  },
  {
    title: "Unused dependencies",
    detects: "Packages installed for experiments and never removed.",
    evidence: "Manifest entry with no import-graph usage",
    posture: "REVIEW FIRST",
    action: "Remove after confirmation",
  },
  {
    title: "Orphan modules",
    detects: "Utilities and routes disconnected from the live app flow.",
    evidence: "Reachability analysis from entrypoints",
    posture: "REVIEW FIRST",
    action: "Flag for human structural decision",
  },
  {
    title: "Temporary artifacts",
    detects: "Debug scripts, scratch files, and AI leftovers.",
    evidence: "Naming patterns + zero references + protected-path check",
    posture: "SAFE CANDIDATE",
    action: "Delete in isolated branch",
  },
  {
    title: "AI-generated structural drift",
    detects: "Conflicting clients, duplicated helpers, and pattern sprawl.",
    evidence: "Clustered findings across commits",
    posture: "REVIEW FIRST",
    action: "Bound cleanup into one contract",
  },
] as const;

export function CleanupCapabilitiesSection() {
  const [open, setOpen] = useState<string | null>(CAPABILITIES[1].title);
  return (
    <section className="py-14 sm:py-16">
      <Container>
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
            Capabilities
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
            Conservative cleanup for the debt AI-built repositories accumulate.
          </h2>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITIES.map((item) => {
            const isOpen = open === item.title;
            return (
              <button
                key={item.title}
                type="button"
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  isOpen
                    ? "border-[rgba(32,191,255,0.35)] bg-[#0F1A25]"
                    : "border-[rgba(139,164,190,0.2)] bg-[#0B141E] hover:border-[rgba(32,191,255,0.25)]"
                )}
                onClick={() => setOpen(isOpen ? null : item.title)}
                aria-expanded={isOpen}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-[#F2F6FA]">{item.title}</h3>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] uppercase tracking-[0.08em]",
                      item.posture === "SAFE CANDIDATE"
                        ? "text-[#21D9A0]"
                        : "text-[#F3B942]"
                    )}
                  >
                    {item.posture}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#8FA2B7]">{item.detects}</p>
                {isOpen ? (
                  <div className="mt-3 space-y-2 border-t border-[rgba(139,164,190,0.14)] pt-3 font-mono text-[11px] text-[#8FA2B7]">
                    <p>
                      <span className="text-[#66788D]">Evidence: </span>
                      {item.evidence}
                    </p>
                    <p>
                      <span className="text-[#66788D]">Possible action: </span>
                      {item.action}
                    </p>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

export function ProductWorkflowSection() {
  const steps = [
    { label: "Scan", href: "/app" },
    { label: "Findings", href: "/app?tab=findings" },
    { label: "Review Batch", href: "/app?tab=findings" },
    { label: "Fix & PR", href: "/app?tab=patch" },
    { label: "Verify", href: "/app?tab=verify" },
    { label: "Receipt", href: "/app?tab=verify" },
  ];
  return (
    <section id="how-it-works" className="border-y border-[rgba(139,164,190,0.2)] bg-[#08111A]/70 py-14 sm:py-16">
      <Container>
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
            Product workflow
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
            From repository URL to review-ready pull request.
          </h2>
          <p className="mt-4 text-base text-[#8FA2B7]">
            This is the buyer experience. Green PR Protocol describes the trust architecture.
          </p>
        </div>
        <ol className="mt-8 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-stretch">
          {steps.map((step, index) => (
            <li key={step.label} className="flex flex-1 items-center gap-3 md:min-w-[140px]">
              <Link
                href={step.href}
                className="flex w-full items-center gap-3 rounded-lg border border-[rgba(139,164,190,0.2)] bg-[#0B141E] px-3 py-3 transition-colors hover:border-[rgba(32,191,255,0.35)]"
              >
                <span className="font-mono text-[11px] text-[#20BFFF]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-medium text-[#F2F6FA]">{step.label}</span>
              </Link>
              {index < steps.length - 1 ? (
                <ArrowRight className="hidden h-4 w-4 shrink-0 text-[#66788D] md:block" aria-hidden />
              ) : null}
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

export function SafetyBoundariesSection() {
  const columns = [
    {
      title: "SAFE CANDIDATE",
      color: "text-[#21D9A0]",
      border: "border-[rgba(33,217,160,0.3)]",
      items: [
        "Evidence complete",
        "Deterministic operation",
        "Within contract",
        "Eligible for execution",
      ],
    },
    {
      title: "REVIEW FIRST",
      color: "text-[#F3B942]",
      border: "border-[rgba(243,185,66,0.3)]",
      items: [
        "Evidence incomplete",
        "Dynamic usage possible",
        "Structural decision required",
        "Human approval needed",
      ],
    },
    {
      title: "PROTECTED",
      color: "text-[#FF6378]",
      border: "border-[rgba(255,99,120,0.28)]",
      items: [
        "Authentication",
        "Environment configuration",
        "Database migrations",
        "Security-sensitive paths",
        "Excluded from autonomous changes",
      ],
    },
  ];
  return (
    <section className="py-14 sm:py-16">
      <Container>
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
            Safety boundaries
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
            Autonomous where evidence is strong.
            <br />
            Blocked where evidence is incomplete.
          </h2>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {columns.map((column) => (
            <div
              key={column.title}
              className={cn("rounded-xl border bg-[#0B141E] p-5", column.border)}
            >
              <h3 className={cn("font-mono text-[12px] uppercase tracking-[0.12em]", column.color)}>
                {column.title}
              </h3>
              <ul className="mt-4 space-y-2">
                {column.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-[#8FA2B7]">
                    <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", column.color)} aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function A2aDeliverySection() {
  return (
    <section className="border-y border-[rgba(139,164,190,0.2)] bg-[#08111A]/70 py-14 sm:py-16">
      <Container>
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#66788D]">
              Agent-to-agent delivery
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
              Built for humans and autonomous buyers.
            </h2>
            <p className="mt-4 max-w-[650px] text-base leading-relaxed text-[#8FA2B7]">
              A human can scan and approve cleanup through the RepoDiet workspace. An autonomous
              buyer can request repository analysis, negotiate exact scope, fund the task, verify
              the Green PR, and accept delivery.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[rgba(139,164,190,0.2)] bg-[#0B141E] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#20BFFF]">
                  A2MCP
                </p>
                <p className="mt-2 text-sm text-[#F2F6FA]">
                  Read-only paid analysis and verification calls
                </p>
              </div>
              <div className="rounded-xl border border-[rgba(139,164,190,0.2)] bg-[#0B141E] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#21D9A0]">
                  A2A
                </p>
                <p className="mt-2 text-sm text-[#F2F6FA]">Negotiated cleanup delivery</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-[rgba(139,164,190,0.2)] bg-[#0B141E] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#66788D]">
              Marketplace status
            </p>
            <ul className="mt-4 space-y-3 font-mono text-[12px]">
              <li className="flex justify-between gap-3 text-[#8FA2B7]">
                <span>OKX listing</span>
                <span className="text-[#F3B942]">Under review</span>
              </li>
              <li className="flex justify-between gap-3 text-[#8FA2B7]">
                <span>A2A</span>
                <span className="text-[#21D9A0]">Registered</span>
              </li>
              <li className="flex justify-between gap-3 text-[#8FA2B7]">
                <span>A2MCP</span>
                <span className="text-[#21D9A0]">Production-ready</span>
              </li>
              <li className="flex justify-between gap-3 text-[#8FA2B7]">
                <span>Recommendation eligibility</span>
                <span className="text-[#F3B942]">Pending marketplace approval</span>
              </li>
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-[#66788D]">
              RepoDiet is not presented as publicly listed on OKX until listing approval is
              confirmed.
            </p>
            <Button asChild variant="secondary" className="mt-4">
              <Link href="/okx">View OKX integration</Link>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function FinalCtaSection() {
  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(rgba(32,191,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(32,191,255,0.05) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
        }}
      />
      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-[#F2F6FA] sm:text-4xl">
            See what your repository can safely lose.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#8FA2B7] sm:text-lg">
            Scan a public JavaScript or TypeScript repository. Review the evidence before RepoDiet
            proposes any change.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/app">
                Scan a Repository <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/app?demo=1">Try the Demo Repository</Link>
            </Button>
          </div>
          <p className="mt-4">
            <Link
              href="/#green-pr-protocol"
              className="font-mono text-[12px] text-[#8FA2B7] transition-colors hover:text-[#46D1FF]"
            >
              Read the Green PR Protocol →
            </Link>
          </p>
        </div>
      </Container>
    </section>
  );
}
