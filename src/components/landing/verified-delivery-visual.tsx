import { ArrowRight, CheckCircle2, FileText, GitPullRequest, GitBranch, ShieldCheck, Lock, Folder } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/design-system/panel";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Stage = {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent: "electric" | "signal" | "muted";
};

function StageNode({ stage, active = false }: { stage: Stage; active?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] transition-colors",
          stage.accent === "electric"
            ? active
              ? "border-electric/50 bg-electric/15 text-electric"
              : "border-electric/30 bg-electric/5 text-electric"
            : stage.accent === "signal"
              ? active
                ? "border-signal/50 bg-signal/15 text-signal"
                : "border-signal/30 bg-signal/10 text-signal"
              : "border-border/60 bg-card text-muted-foreground"
        )}
        aria-hidden
      >
        {stage.icon}
        <span className="sr-only">{stage.title}</span>
      </div>
      <div className="text-center">
        <p className="font-mono text-[10px] text-muted-foreground">{stage.number}</p>
        <p
          className={cn(
            "mt-1 font-mono text-[11px] uppercase tracking-wide",
            stage.accent === "signal" ? "text-signal" : "text-foreground"
          )}
        >
          {stage.title}
        </p>
        <p className="mt-1 font-mono text-[9.5px] text-muted-foreground">{stage.subtitle}</p>
      </div>
    </div>
  );
}

function ConnectorLine() {
  return (
    <div className="relative flex-1 px-2 pt-5" aria-hidden>
      <div
        className={cn(
          "h-px w-full bg-border/50",
          "motion-safe:animate-pulse-subtle motion-reduce:animate-none"
        )}
      />
      <div className="absolute right-0 top-[18px]">
        <ArrowRight className="h-3.5 w-3.5 text-electric/60" aria-hidden />
      </div>
    </div>
  );
}

export function VerifiedDeliveryVisual() {
  const stages: Stage[] = [
    {
      id: "analyze",
      number: "01",
      title: "Analyze",
      subtitle: "Repository evidence",
      icon: <Folder className="h-4 w-4" aria-hidden />,
      accent: "electric",
    },
    {
      id: "approve",
      number: "02",
      title: "Approve Scope",
      subtitle: "Selected findings only",
      icon: <FileText className="h-4 w-4" aria-hidden />,
      accent: "electric",
    },
    {
      id: "execute",
      number: "03",
      title: "Execute",
      subtitle: "Isolated task branch",
      icon: <GitBranch className="h-4 w-4" aria-hidden />,
      accent: "muted",
    },
    {
      id: "verify",
      number: "04",
      title: "Verify",
      subtitle: "Build, tests & protected paths",
      icon: <ShieldCheck className="h-4 w-4" aria-hidden />,
      accent: "signal",
    },
    {
      id: "deliver",
      number: "05",
      title: "Deliver",
      subtitle: "Review-ready pull request",
      icon: <GitPullRequest className="h-4 w-4" aria-hidden />,
      accent: "signal",
    },
  ];

  const activeStageIds = new Set(["analyze", "approve", "verify", "deliver"]);

  return (
    <Panel
      variant="elevated"
      padding="none"
      className="relative overflow-hidden rounded-xl border border-border/70 bg-[#05080D]/55 shadow-artifact-hover"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              RepoDiet Delivery
            </p>
            <h2 className="mt-1 font-mono text-[14px] font-semibold text-foreground">
              Verified Delivery Map
            </h2>
          </div>
          <Badge variant="signal" className="font-mono text-[10px]">
            Buyer controlled
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
            No direct main push
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-electric" aria-hidden />
            Scope locked before execution
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" aria-hidden />
            Owner merges the final result
          </span>
        </div>

        {/* Workflow */}
        <div className="mt-6">
          {/* A2MCP / A2A hints */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="cyan" className="font-mono text-[10px]">
              A2MCP · Analyze repository
            </Badge>
            <Badge variant="signal" className="font-mono text-[10px]">
              A2A · Deliver cleanup PR
            </Badge>
          </div>

          <div className="relative mt-4">
            {/* Desktop: horizontal pipeline */}
            <div className="hidden lg:block">
              <div className="flex items-start">
                <StageNode stage={stages[0]} active={activeStageIds.has(stages[0].id)} />
                <ConnectorLine />
                <StageNode stage={stages[1]} active={activeStageIds.has(stages[1].id)} />
                <ConnectorLine />
                <StageNode stage={stages[2]} active={activeStageIds.has(stages[2].id)} />
                <ConnectorLine />
                <StageNode stage={stages[3]} active={activeStageIds.has(stages[3].id)} />
                <ConnectorLine />
                <StageNode stage={stages[4]} active={activeStageIds.has(stages[4].id)} />
              </div>
            </div>

            {/* Mobile: vertical connected sequence */}
            <div className="lg:hidden">
              <div className="flex flex-col items-center gap-6">
                {stages.map((stage, i) => (
                  <div key={stage.id} className="flex w-full flex-col items-center">
                    <StageNode stage={stage} active={activeStageIds.has(stage.id)} />
                    {i < stages.length - 1 && (
                      <div className="relative mt-3 flex items-center justify-center" aria-hidden>
                        <div className="h-10 w-px bg-border/50 motion-safe:animate-pulse-subtle motion-reduce:animate-none" />
                        <ArrowRight className="absolute -bottom-0.5 h-3.5 w-3.5 rotate-[-90deg] text-electric/60" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-[#05080D]/35 p-4">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-electric" aria-hidden />
                <p className="font-mono text-[11px] font-semibold text-electric">Example delivery boundary</p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Illustrative allowed/protected paths that RepoDiet keeps within scope. This is an example, not your current repository state.
              </p>

              <div className="mt-3 space-y-3">
                <div>
                  <p className="font-mono text-[10px] text-muted-foreground">Allowed</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-md border border-border/60 bg-card px-2 py-1 font-mono text-[9.5px] text-muted-foreground">
                      src/components/*
                    </span>
                    <span className="rounded-md border border-border/60 bg-card px-2 py-1 font-mono text-[9.5px] text-muted-foreground">
                      package.json dependency removal
                    </span>
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[10px] text-muted-foreground">Protected</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-md border border-border/60 bg-card px-2 py-1 font-mono text-[9.5px] text-muted-foreground">
                      .env*
                    </span>
                    <span className="rounded-md border border-border/60 bg-card px-2 py-1 font-mono text-[9.5px] text-muted-foreground">
                      auth/*
                    </span>
                    <span className="rounded-md border border-border/60 bg-card px-2 py-1 font-mono text-[9.5px] text-muted-foreground">
                      database migrations
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-[#05080D]/35 p-4">
              <p className="font-mono text-[11px] font-semibold text-foreground">Scope boundary → bounded execution</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Analysis discovers the work. A2A delivers the approved outcome.
              </p>
              <div className="mt-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-electric" aria-hidden />
                  <p className="text-xs text-muted-foreground">Only selected findings are executed</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
                  <p className="text-xs text-muted-foreground">Verification blocks unsafe paths</p>
                </div>
              </div>
            </div>
          </div>

          {/* Output card */}
          <div className="mt-5 rounded-xl border border-signal/30 bg-signal/10 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Example output
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-signal" aria-hidden />
                  <p className="font-mono text-[12px] font-semibold text-foreground">
                    PR #128 · Repository cleanup
                  </p>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  Ready for review
                </p>
              </div>

              <div className="min-w-[160px] rounded-lg border border-signal/20 bg-[#05080D]/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[10px] text-muted-foreground">Status</p>
                  <span className="font-mono text-[10px] text-signal">Verified</span>
                </div>
                <div className="mt-2 h-px bg-signal/20" aria-hidden />
                <p className="mt-2 font-mono text-[9.5px] text-muted-foreground">
                  Buyer decision required
                </p>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              <li className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-4 w-4 rounded-full bg-signal/15" aria-hidden />
                <p>
                  <span className="font-semibold">3 approved changes</span>{" "}
                  <span className="text-muted-foreground">(Example)</span>
                </p>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-4 w-4 rounded-full bg-signal/15" aria-hidden />
                <p>
                  <span className="font-semibold">Protected paths unchanged</span>{" "}
                  <span className="text-muted-foreground">(Example)</span>
                </p>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-4 w-4 rounded-full bg-signal/15" aria-hidden />
                <p>
                  <span className="font-semibold">Required checks passed</span>{" "}
                  <span className="text-muted-foreground">(Example)</span>
                </p>
              </li>
            </ul>

            <div className="mt-4 rounded-lg border border-electric/30 bg-electric/5 p-3">
              <p className="font-mono text-[11px] font-semibold text-electric">Review Pull Request</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This is a visual only. The homepage CTAs lead to the real workflow in the app.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

