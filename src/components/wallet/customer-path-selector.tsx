"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { resolveOkxAgentUrl } from "@/lib/wallet/okx-agent-url";
import { getCanonicalOkxIdentityPublic } from "@/lib/okx/identity-public";

/**
 * Fix & PR uses OKX A2A escrow only (service 32947).
 * Direct-site wallet transfer is no longer offered.
 */
export function CustomerPathSelector() {
  const okxUrl = resolveOkxAgentUrl();
  const identity = getCanonicalOkxIdentityPublic();

  return (
    <Panel variant="elevated" padding="md" className="space-y-3">
      <p className="ds-label">Payment rail</p>
      <div className="rounded-md border border-electric/40 bg-electric/5 p-3 text-sm">
        <p className="font-medium text-foreground">
          OKX A2A escrow · service {identity.a2aServiceId}
        </p>
        <p className="mt-1 text-muted-foreground">
          RepoDiet Fix &amp; PR runs as registered OKX A2A service {identity.a2aServiceId} (ASP{" "}
          {identity.aspAgentId}). You authorize the service, fund OKX escrow, review the pull
          request, then accept delivery so OKX can release payment.
        </p>
        <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
          <li>Funds stay in OKX escrow during cleanup and verification</li>
          <li>RepoDiet never asks for a direct USDT transfer to its wallet</li>
          <li>Acceptance and release follow the official OKX A2A lifecycle</li>
        </ul>
        {okxUrl ? (
          <Button asChild size="sm" className="mt-3" variant="secondary">
            <Link href={okxUrl} target="_blank" rel="noreferrer">
              Open OKX.AI agent page
            </Link>
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
