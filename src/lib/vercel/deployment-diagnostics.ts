import type {
  CheckRunConclusion,
  CheckRunStatus,
  PrCheckRecord,
  VercelProjectCheck,
  VercelProjectsSummary,
} from "@/lib/github/pr-check-types";

const VERCEL_CHECK_RE = /^vercel\s*[–—-]\s*(.+)$/i;

export function parseVercelProjectName(checkName: string): string | undefined {
  const match = VERCEL_CHECK_RE.exec(checkName.trim());
  return match?.[1]?.trim();
}

export function isVercelCheckName(checkName: string): boolean {
  return VERCEL_CHECK_RE.test(checkName.trim()) || /^vercel\b/i.test(checkName.trim());
}

export function detectVercelProjects(input: {
  checks: PrCheckRecord[];
  repositoryName?: string;
  productionDomainHint?: string;
}): VercelProjectsSummary | undefined {
  const vercelChecks = input.checks.filter((check) => isVercelCheckName(check.checkName));
  if (vercelChecks.length === 0) return undefined;

  const projects: VercelProjectCheck[] = vercelChecks.map((check) => {
    const name = parseVercelProjectName(check.checkName) ?? check.checkName;
    const repoName = input.repositoryName?.toLowerCase();
    const domainHint = input.productionDomainHint?.toLowerCase();
    const nameLower = name.toLowerCase();

    let likelyCanonical = false;
    let reason = "Connected Vercel project for this repository.";

    if (domainHint && nameLower.includes(domainHint.replace(/\./g, ""))) {
      likelyCanonical = true;
      reason = "Production domain matches repository metadata.";
    } else if (repoName && (nameLower.includes(repoName) || repoName.includes(nameLower))) {
      likelyCanonical = true;
      reason = "Project name closely matches repository name.";
    } else if (vercelChecks.length === 1) {
      likelyCanonical = true;
      reason = "Only one Vercel project is connected to this repository.";
    } else {
      reason = "Additional Vercel project integration detected.";
    }

    return {
      name,
      status: check.status,
      conclusion: check.conclusion,
      likelyCanonical,
      reason,
      deploymentUrl: check.detailsUrl,
    };
  });

  const ownerAction =
    projects.length > 1
      ? "Review connected Vercel projects and confirm which preview deployments are required for this repository."
      : undefined;

  return {
    provider: "vercel",
    projects,
    ownerAction,
  };
}

export function parseVercelEvidence(summary?: string, text?: string): {
  buildPhase?: string;
  environmentType?: string;
  rootDirectory?: string;
  framework?: string;
  buildCommand?: string;
  firstError?: string;
} {
  const evidence = [summary, text].filter(Boolean).join("\n");
  return {
    buildPhase: evidence.match(/build phase:\s*([^\n]+)/i)?.[1]?.trim(),
    environmentType: evidence.match(/environment:\s*([^\n]+)/i)?.[1]?.trim(),
    rootDirectory: evidence.match(/root directory:\s*([^\n]+)/i)?.[1]?.trim(),
    framework: evidence.match(/framework:\s*([^\n]+)/i)?.[1]?.trim(),
    buildCommand: evidence.match(/build command:\s*([^\n]+)/i)?.[1]?.trim(),
    firstError: evidence
      .split("\n")
      .find((line) => /error|failed|cannot/i.test(line))
      ?.trim(),
  };
}

export function mapCheckStatus(status: string, conclusion?: string | null): {
  status: CheckRunStatus;
  conclusion: CheckRunConclusion;
} {
  if (status === "queued") return { status: "queued", conclusion: null };
  if (status === "in_progress") return { status: "in_progress", conclusion: null };
  if (status === "completed") {
    const normalized = (conclusion ?? "failure") as CheckRunConclusion;
    return { status: "completed", conclusion: normalized };
  }
  return { status: "pending", conclusion: null };
}
