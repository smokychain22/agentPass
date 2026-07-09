import Link from "next/link";
import {
  ArrowRight,
  Copy,
  FileCode2,
  GitBranch,
  Package,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";

const problems = [
  {
    title: "AI code bloat",
    description: "Vibe-coded repos accumulate layers of generated scaffolding that nobody audits.",
    icon: FileCode2,
  },
  {
    title: "Duplicate components",
    description: "Button2, ComponentFinal, and copy-paste variants silently multiply.",
    icon: Copy,
  },
  {
    title: "Dead files",
    description: "Orphan utilities and backup folders linger after rapid iteration.",
    icon: Package,
  },
  {
    title: "Unused packages",
    description: "Dependencies pile up from AI suggestions that never shipped.",
    icon: GitBranch,
  },
  {
    title: "Fragile fixes",
    description: "Deleting the wrong file breaks routes nobody documented.",
    icon: ShieldAlert,
  },
];

const flowSteps = [
  "Repo URL",
  "Scan",
  "Findings",
  "Patch Kit",
  "Regression Checklist",
];

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="max-w-3xl">
            <Badge variant="electric" className="mb-6">
              OKX.AI Software Utility · A2MCP
            </Badge>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
              AI built your app fast.
              <br />
              <span className="text-electric">RepoDiet keeps the codebase alive.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg leading-relaxed">
              Scan AI-built JavaScript and TypeScript repos for duplicate code, dead files, unused
              dependencies, orphan routes, and generate a safe cleanup patch.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/app">Run Scan</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/app">View Demo</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/okx">OKX ASP</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section className="border-y border-border bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              The problem
            </h2>
            <p className="mt-2 max-w-xl text-2xl font-semibold tracking-tight">
              Fast AI output. Slow cleanup debt.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {problems.map((item) => (
                <Card key={item.title} className="border-border/80 bg-card/60">
                  <CardHeader className="pb-2">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded border border-border bg-muted/50">
                      <item.icon className="h-4 w-4 text-electric" />
                    </div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Product flow */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Product flow
          </h2>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            From repo URL to regression checklist
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-2 sm:gap-3">
            {flowSteps.map((step, i) => (
              <div key={step} className="flex items-center gap-2 sm:gap-3">
                <div className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium sm:px-4">
                  {step}
                </div>
                {i < flowSteps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* OKX */}
        <section className="border-t border-border bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <Badge variant="signal" className="mb-4">
                  OKX.AI Genesis Hackathon
                </Badge>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Built for the agent economy
                </h2>
                <p className="mt-4 text-muted-foreground leading-relaxed">
                  RepoDiet ships as a Software Utility ASP with A2MCP scanner tools and an A2A
                  cleanup service. Agents scan repos, generate patch bundles, and export regression
                  contracts — paid via x402 on X Layer.
                </p>
                <Button asChild className="mt-6" variant="secondary">
                  <Link href="/okx">
                    View OKX ASP details
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="border-border/80">
                  <CardHeader>
                    <Wrench className="mb-2 h-4 w-4 text-electric" />
                    <CardTitle className="text-base">A2MCP tools</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      scan_repo_bloat, detect_duplicate_code, find_dead_files, generate_cleanup_patch
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-border/80">
                  <CardHeader>
                    <ShieldAlert className="mb-2 h-4 w-4 text-signal" />
                    <CardTitle className="text-base">A2A service</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      RepoDiet — Clean my AI-built app repo
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
