import Link from "next/link";
import { ArrowLeft, Blocks, Cpu, Network } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const liveTools = [
  "scan_repo_bloat",
  "detect_framework",
  "read_file_tree",
];

const comingTools = [
  "detect_duplicate_code",
  "find_dead_files",
  "find_unused_dependencies",
  "generate_cleanup_patch",
  "generate_regression_checklist",
];

const pricing = [
  { tool: "Quick scan", price: "0.05 USDT" },
  { tool: "Deep scan", price: "0.15 USDT" },
  { tool: "Patch bundle", price: "0.25 USDT" },
];

export default function OkxPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <Badge variant="electric" className="mb-4">
          OKX.AI ASP
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          RepoDiet on OKX.AI
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
          RepoDiet is a Software Utility Agent Service Provider for the OKX.AI Genesis Hackathon.
          Agents invoke scanner tools via A2MCP and request full cleanup workflows via A2A — settled
          with x402 micropayments on X Layer.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Card className="border-border/80">
            <CardHeader>
              <Blocks className="mb-2 h-4 w-4 text-electric" />
              <CardTitle className="text-sm">Category</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Software Utility
            </CardContent>
          </Card>
          <Card className="border-border/80">
            <CardHeader>
              <Cpu className="mb-2 h-4 w-4 text-electric" />
              <CardTitle className="text-sm">A2MCP</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              3 live · 5 coming next
            </CardContent>
          </Card>
          <Card className="border-border/80">
            <CardHeader>
              <Network className="mb-2 h-4 w-4 text-signal" />
              <CardTitle className="text-sm">A2A</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Clean my AI-built app repo
            </CardContent>
          </Card>
        </div>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">A2MCP — live now</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Callable today via the RepoDiet scan API and agent integrations.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {liveTools.map((tool) => (
              <Badge key={tool} variant="signal" className="font-mono text-xs">
                {tool}
              </Badge>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">A2MCP — coming next</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Deep analysis and patch generation ship in Phase 3.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {comingTools.map((tool) => (
              <Badge key={tool} variant="default" className="font-mono text-xs opacity-70">
                {tool}
              </Badge>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Pricing (x402)</h2>
          <div className="mt-4 space-y-2">
            {pricing.map((row) => (
              <div
                key={row.tool}
                className="flex items-center justify-between rounded-md border border-border bg-card/50 px-4 py-3 text-sm"
              >
                <span>{row.tool}</span>
                <span className="font-mono text-electric">{row.price}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-12 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/app">Run Scan</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/docs">Read Docs</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
