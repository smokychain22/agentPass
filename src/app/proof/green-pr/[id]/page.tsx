import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { SiteFooter, SiteHeader } from "@/components/layout/site-header";
import {
  decodeAttestationStatement,
  getGreenPrAttestation,
  getMaintenanceContractByDigest,
  trustedKeyMapFromEnvironment,
  verifyGreenPrAttestation,
} from "@/lib/green-pr";

export const dynamic = "force-dynamic";

function short(value: string, length = 16): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <Badge variant={ok ? "signal" : "danger"}>
      {children}
    </Badge>
  );
}

export default async function GreenPrProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const attestation = await getGreenPrAttestation(id);
  if (!attestation) notFound();
  const statement = decodeAttestationStatement(attestation);
  const contract = await getMaintenanceContractByDigest(statement.predicate.contractDigest);
  if (!contract) notFound();
  const trustedPublicKeys = trustedKeyMapFromEnvironment("GREEN_PR");
  const verification = verifyGreenPrAttestation(attestation, {
    contractRecord: contract,
    trustedPublicKeys,
  });
  const predicate = statement.predicate;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">
        <div className="mb-8 max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-electric">
            RepoDiet Green PR Protocol
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Proof-carrying repository maintenance
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This page verifies the signed contract, bounded execution, pull-request head,
            required checks, receipt binding and acceptance recommendation.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Status ok={verification.valid}>
              {verification.valid ? "Attestation verified" : "Verification failed"}
            </Status>
            <Status ok={verification.scopeRespected}>
              {verification.scopeRespected ? "Scope respected" : "Scope not proven"}
            </Status>
            <Status ok={verification.requiredChecksPassed}>
              {verification.requiredChecksPassed ? "Blocking checks passed" : "Checks incomplete"}
            </Status>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel padding="lg">
            <h2 className="text-lg font-semibold">Maintenance contract</h2>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Contract</dt>
                <dd className="mt-1 font-mono">{contract.contractId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Digest</dt>
                <dd className="mt-1 font-mono" title={contract.contractDigest}>
                  {short(contract.contractDigest, 24)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Repository</dt>
                <dd className="mt-1">{predicate.repository}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Source commit</dt>
                <dd className="mt-1 font-mono" title={predicate.sourceCommit}>
                  {short(predicate.sourceCommit)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">ASP / service</dt>
                <dd className="mt-1">
                  {predicate.commercialEvidence.aspId} / {predicate.commercialEvidence.serviceId}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Settlement</dt>
                <dd className="mt-1">
                  {predicate.commercialEvidence.amount} USD₮0 · {predicate.commercialEvidence.network}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel padding="lg">
            <h2 className="text-lg font-semibold">Green PR delivery</h2>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Pull request</dt>
                <dd className="mt-1">#{predicate.pullRequest.number}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">PR head</dt>
                <dd className="mt-1 font-mono" title={predicate.pullRequest.headCommit}>
                  {short(predicate.pullRequest.headCommit)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Files changed</dt>
                <dd className="mt-1">{predicate.filesChanged.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">New diagnostics</dt>
                <dd className="mt-1">{predicate.verification.newDiagnostics.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Receipt</dt>
                <dd className="mt-1 font-mono">
                  {predicate.commercialEvidence.receiptId}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Recommendation</dt>
                <dd className="mt-1 font-semibold">
                  {verification.acceptanceRecommendation}
                </dd>
              </div>
            </dl>
          </Panel>
        </div>

        <Panel padding="lg" className="mt-5">
          <h2 className="text-lg font-semibold">Contracted changes</h2>
          <ul className="mt-4 divide-y divide-border/60 text-sm">
            {predicate.filesChanged.map((change) => (
              <li key={`${change.path}-${change.operation}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-mono">{change.path}</span>
                <span className="text-muted-foreground">
                  {change.operation} · +{change.linesAdded} / −{change.linesDeleted}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {!verification.valid && (
          <Panel variant="danger" padding="lg" className="mt-5">
            <h2 className="text-lg font-semibold">Verification blockers</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {verification.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </Panel>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <a href={predicate.pullRequest.url} target="_blank" rel="noreferrer">
              Open Pull Request
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/api/attestations/${attestation.attestationId}`}>
              View Attestation JSON
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/api/green-pr/contracts/${contract.contractId}`}>
              View Contract JSON
            </Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
