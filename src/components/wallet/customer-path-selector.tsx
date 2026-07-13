"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import type { CustomerExecutionMode } from "@/lib/wallet/types";
import { resolveOkxAgentUrl } from "@/lib/wallet/okx-agent-url";

interface CustomerPathSelectorProps {
  mode: CustomerExecutionMode;
  onModeChange: (mode: CustomerExecutionMode) => void;
}

export function CustomerPathSelector({ mode, onModeChange }: CustomerPathSelectorProps) {
  const okxUrl = resolveOkxAgentUrl();

  return (
    <Panel variant="elevated" padding="md" className="space-y-3">
      <p className="ds-label">How do you want to pay?</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onModeChange("direct")}
          className={`rounded-md border p-3 text-left text-sm transition-colors ${
            mode === "direct"
              ? "border-electric/50 bg-electric/10"
              : "border-border/60 bg-card/40 hover:border-border"
          }`}
        >
          <p className="font-medium text-foreground">Connect wallet and continue directly</p>
          <p className="mt-1 text-muted-foreground">
            Pay from your own wallet on X Layer. RepoDiet verifies payment server-side before
            execution.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onModeChange("okx_marketplace")}
          className={`rounded-md border p-3 text-left text-sm transition-colors ${
            mode === "okx_marketplace"
              ? "border-electric/50 bg-electric/10"
              : "border-border/60 bg-card/40 hover:border-border"
          }`}
        >
          <p className="font-medium text-foreground">Use through OKX.AI</p>
          <p className="mt-1 text-muted-foreground">
            Hire ASP 5283 on OKX.AI. Your Agentic Wallet funds A2A escrow — no website wallet
            needed.
          </p>
        </button>
      </div>

      {mode === "okx_marketplace" && (
        <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">OKX.AI marketplace path</p>
          <ul className="list-inside list-disc space-y-1">
            <li>A2MCP 32948 — callable Quick Triage via x402</li>
            <li>A2A 32947 — negotiated Cleanup Operator with escrow and acceptance</li>
          </ul>
          {okxUrl ? (
            <Button asChild size="sm" className="mt-3">
              <Link href={okxUrl} target="_blank" rel="noreferrer">
                Open OKX.AI agent page
              </Link>
            </Button>
          ) : (
            <p className="mt-2 text-xs">
              OKX agent listing link is not configured. Set{" "}
              <span className="font-mono">NEXT_PUBLIC_OKX_AGENT_URL</span> on Vercel when ASP 5283
              is publicly listed.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
