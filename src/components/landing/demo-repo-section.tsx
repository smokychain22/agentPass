import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DEMO_SCAN_STATS, DEMO_SECTION } from "@/lib/marketing/content";
import { DEMO_REPO_URL } from "@/lib/demo/constants";

export function DemoRepoSection() {
  const stats = [
    { label: "Duplicate clusters", value: DEMO_SCAN_STATS.duplicateClusters },
    { label: "Unused files", value: DEMO_SCAN_STATS.unusedFiles },
    { label: "Safe candidates", value: DEMO_SCAN_STATS.safeCandidates },
    { label: "AI-slop signals", value: DEMO_SCAN_STATS.aiSlopSignals },
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {DEMO_SECTION.eyebrow}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {DEMO_SECTION.title}
        </h2>
        <p className="mt-4 text-muted-foreground leading-relaxed">{DEMO_SECTION.description}</p>
        <p className="mt-3 font-mono text-xs text-muted-foreground">{DEMO_REPO_URL}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/app?demo=true">
              <FlaskConical className="h-4 w-4" />
              Try Messy Demo Repo
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/demo/sample-bundle" download>
              See Sample Bundle
            </a>
          </Button>
        </div>
      </div>

      <Card className="border-border/80 bg-card/60">
        <CardContent className="p-6">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-wider text-electric">
            Live demo scan output
          </p>
          <dl className="grid grid-cols-2 gap-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-md border border-border/60 bg-background/40 px-4 py-3"
              >
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold text-foreground">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            Real findings from the seeded demo repo — not hardcoded JSON.
          </p>
          <Link
            href="/app?demo=true"
            className="mt-4 inline-flex items-center gap-1 text-sm text-electric hover:underline"
          >
            Run full demo flow
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
