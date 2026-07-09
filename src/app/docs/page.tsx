import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const sections = [
  {
    title: "Quick start",
    items: [
      "Open the app and paste a public GitHub repository URL",
      "Run a Quick scan to inspect repository structure",
      "Review findings, generate a patch kit, and verify with the regression checklist",
    ],
  },
  {
    title: "API (coming soon)",
    items: [
      "POST /api/scans/demo — bundled demo repository",
      "POST /api/tools/scan_repo_bloat — A2MCP scanner",
      "POST /api/tools/generate_cleanup_patch — patch bundle export",
    ],
  },
  {
    title: "Phase roadmap",
    items: [
      "Phase 1 — Premium UI shell and scan flow (current)",
      "Phase 2 — Real scanning engine and findings",
      "Phase 3 — Patch kit, regression contract, x402 payments",
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <Badge variant="muted" className="mb-4">
          Documentation
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">RepoDiet Docs</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          Developer documentation for the RepoDiet OKX.AI Software Utility ASP. Full API reference
          and integration guides ship with Phase 2.
        </p>

        <div className="mt-10 space-y-6">
          {sections.map((section) => (
            <Card key={section.title} className="border-border/80">
              <CardHeader>
                <CardTitle className="text-base">{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-electric">—</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
