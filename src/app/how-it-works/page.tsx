import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  GitPullRequest,
  LockKeyhole,
  SearchCode,
  ShieldCheck,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/layout/site-header";
import { Container } from "@/components/design-system/container";
import { GridBackground } from "@/components/design-system/grid-background";
import { Panel } from "@/components/design-system/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How RepoDiet Works",
  description:
    "How RepoDiet analyzes repository debt, performs approved cleanup, creates a pull request, and verifies delivery.",
};

const workflow = [
  {
    title: "Connect repository",
    body: "Choose a public GitHub repository and branch. RepoDiet binds the run to the exact source commit.",
    evidence: "Repository, branch, source commit",
  },
  {
    title: "Analyze",
    body: "RepoDiet maps the project and finds duplicate code, unused files and dependencies, orphan modules, and protected paths.",
    evidence: "Prioritized, file-level findings",
  },
  {
    title: "Review findings",
    body: "You choose the maintenance work RepoDiet may perform. Findings that are unsafe to automate remain review-only.",
    evidence: "Buyer-selected cleanup scope",
  },
  {
    title: "Agree cleanup scope",
    body: "The job pins allowed changes, protected files, verification checks, repository state, and negotiated price.",
    evidence: "Bounded maintenance contract",
  },
  {
    title: "Execute in isolation",
    body: "RepoDiet applies only eligible, approved changes away from the main branch and rejects changes it cannot verify.",
    evidence: "Change manifest and check results",
  },
  {
    title: "Create pull request",
    body: "A real GitHub branch and pull request are opened against the selected base branch. RepoDiet never merges it automatically.",
    evidence: "Review-ready GitHub pull request",
  },
  {
    title: "Review and accept",
    body: "RepoDiet compares the result with the pinned source, checks scope and protected paths, and reports build and test outcomes.",
    evidence: "Verification result and receipt",
  },
  {
    title: "Buyer decides",
    body: "The buyer reviews the pull request and evidence before accepting delivery. The repository owner remains in control.",
    evidence: "Buyer decision and settlement evidence",
  },
] as const;

const audiences = [
  "Solo builders using AI coding tools",
  "Agencies preparing client handoffs",
  "Startups moving toward production",
  "Engineering teams managing repository debt",
  "Non-technical owners who need reviewable delivery",
  "Buyer agents purchasing maintenance work",
] as const;

export default function HowItWorksPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <GridBackground variant="subtle" className="fixed inset-0 z-0" />
      <SiteHeader />
      <main className="relative z-10 flex-1">
        <Container className="py-16 sm:py-24">
          <Badge variant="cyan" className="font-mono text-[10px] uppercase tracking-[0.2em]">
            How RepoDiet works
          </Badge>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
            Repository cleanup that ends with a pull request, not another report.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            AI-assisted development makes software faster to create, but duplicate implementations,
            abandoned experiments, unused dependencies, and risky manual cleanup accumulate. RepoDiet
            turns that debt into bounded maintenance work the buyer can inspect before accepting.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/app">
                Analyze a Repository <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/docs">Read Documentation</Link>
            </Button>
          </div>
        </Container>

        <section className="border-y border-border/60 bg-card/30 py-16 sm:py-20">
          <Container>
            <p className="ds-label">The complete journey</p>
            <h2 className="mt-3 text-3xl font-semibold text-foreground">From repository to buyer decision</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {workflow.map((step, index) => (
                <Panel key={step.title} variant="elevated" padding="md" className="relative">
                  <span className="font-mono text-xs text-electric">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="mt-3 font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  <div className="mt-5 border-t border-border/50 pt-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
                    <p className="mt-1 text-xs text-foreground">{step.evidence}</p>
                  </div>
                </Panel>
              ))}
            </div>
          </Container>
        </section>

        <Container className="py-16 sm:py-20">
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel variant="cyan" padding="lg">
              <SearchCode className="h-6 w-6 text-electric" aria-hidden />
              <p className="ds-label mt-5">A2MCP quick triage</p>
              <h2 className="mt-2 text-2xl font-semibold">Diagnose the repository</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                A fast paid analysis that returns up to five prioritized repository findings. Agents call
                <span className="font-mono text-foreground"> analyze_repository</span> when they need a
                bounded, repeatable diagnosis.
              </p>
            </Panel>
            <Panel variant="elevated" padding="lg">
              <Bot className="h-6 w-6 text-signal" aria-hidden />
              <p className="ds-label mt-5">A2A verified cleanup PR</p>
              <h2 className="mt-2 text-2xl font-semibold">Deliver the maintenance job</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                A negotiated cleanup job in which RepoDiet performs the agreed work and delivers a pull
                request for buyer review. A2MCP diagnoses; A2A delivers.
              </p>
            </Panel>
          </div>
        </Container>

        <section className="border-y border-border/60 bg-card/30 py-16 sm:py-20">
          <Container>
            <div className="max-w-3xl">
              <p className="ds-label">Safety architecture</p>
              <h2 className="mt-3 text-3xl font-semibold">The buyer stays in control</h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                RepoDiet does not push to the main branch or merge automatically. It binds work to a source
                commit, protects sensitive paths, limits changes to the agreed scope, and delivers through a
                reviewable branch.
              </p>
            </div>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [LockKeyhole, "Protected paths", "Routes, configuration, environment files, lockfiles, and public assets are guarded by policy."],
                [GitPullRequest, "Isolated branch", "Every delivered change is reviewable before it reaches the target branch."],
                [ShieldCheck, "Automated checks", "Scope, patch application, protected paths, and available repository checks are evaluated."],
                [CheckCircle2, "Buyer decision", "Delivery evidence supports the decision; it does not replace repository-owner review."],
              ].map(([Icon, title, body]) => {
                const IconComponent = Icon as typeof ShieldCheck;
                return (
                  <Panel key={String(title)} variant="elevated" padding="md">
                    <IconComponent className="h-5 w-5 text-signal" aria-hidden />
                    <h3 className="mt-4 font-semibold">{String(title)}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{String(body)}</p>
                  </Panel>
                );
              })}
            </div>
          </Container>
        </section>

        <Container className="py-16 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <p className="ds-label">Who needs RepoDiet</p>
              <h2 className="mt-3 text-3xl font-semibold">Built for repository owners and their agents</h2>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {audiences.map((audience) => (
                  <li key={audience} className="flex gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                    {audience}
                  </li>
                ))}
              </ul>
            </div>
            <Panel variant="elevated" padding="lg">
              <p className="ds-label">What you receive</p>
              <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
                {[
                  "Prioritized, file-level findings",
                  "A buyer-selected cleanup scope",
                  "A changed-file and verification summary",
                  "A real GitHub pull request",
                  "Rollback information and delivery evidence when available",
                ].map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-electric" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel variant="elevated" padding="lg" className="mt-12">
            <Badge variant="neutral">Roadmap</Badge>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Planned directions include private repository support, broader language support, continuous
              repository-health monitoring, and advanced duplicate-system consolidation. These are roadmap
              items, not currently advertised as active functionality.
            </p>
          </Panel>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}
