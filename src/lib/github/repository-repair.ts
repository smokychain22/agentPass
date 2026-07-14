import fs from "node:fs/promises";
import path from "node:path";
import { GitHubClient } from "@/lib/github/github-client";
import { resolveAspGitHubToken } from "@/lib/asp/github-access";
import { saveAspRepositoryInstallation } from "@/lib/asp/store";
import { getInstallationDetails } from "@/lib/github-app/installations";
import { saveRepoInstallBinding } from "@/lib/github-app/install-flow-store";

export const MERIDIAN_BASELINE_REPAIR_ID = "meridian-baseline-build-2026-07";

const REPAIR_BRANCH = "repair/meridian-baseline-build";

const FILE_MAP: Array<{ repoPath: string; bundleName: string }> = [
  {
    repoPath: "src/app/api/nexus/feed/route.ts",
    bundleName: "src-app-api-nexus-feed-route.ts",
  },
  {
    repoPath: "src/lib/feed-curation.ts",
    bundleName: "src-lib-feed-curation.ts",
  },
  { repoPath: "package.json", bundleName: "package.json" },
  { repoPath: "package-lock.json", bundleName: "package-lock.json" },
];

const PR_BODY = `## Repair Meridian baseline build blocker

### Original diagnostic
\`\`\`
./src/app/api/nexus/feed/route.ts:88:41
Type error: Type 'TokenSecurityReport | undefined' is not assignable to type 'Pick<TokenSecurityReport, "honeypotRisk" | "scamRisk" | "label" | "scamLabel"> | undefined'.
  Property 'scamRisk' is optional in type 'TokenSecurityReport' but required in type 'Pick<...>'.
\`\`\`

### Root cause
1. **feed/route.ts** passed full \`TokenSecurityReport\` into \`discoveryHunterLabel\` where optional \`scamRisk\` is incompatible with the Pick type.
2. **date-fns** is imported by nexus components but was missing from \`package.json\`.
3. **feed-curation.ts** lost required imports (\`isStablecoin\`, \`TokenSecurityReport\`, \`ScamAssessment\`) during an earlier cleanup — logic unchanged.

### Bounded fix
- Normalize security payload before \`discoveryHunterLabel\` in \`feed/route.ts\`
- Add \`date-fns\` dependency
- Restore missing imports in \`feed-curation.ts\` only

### Files changed
- \`src/app/api/nexus/feed/route.ts\`
- \`package.json\` / \`package-lock.json\`
- \`src/lib/feed-curation.ts\` (imports only)

### Verification
- \`npm ci\`: PASS
- \`npm run build\`: PASS

### Untouched
- \`src/lib/token-quote.ts\` — not modified
- feed-curation / token-quote business logic — not modified beyond import restoration

Opened by RepoDiet operator (GitHub App).`;

export interface RepositoryRepairResult {
  ok: boolean;
  repairId: string;
  branch: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  alreadyExisted?: boolean;
  error?: string;
}

async function readBundleFile(bundleName: string): Promise<string> {
  const filePath = path.join(process.cwd(), "meridian-repair", "files", bundleName);
  return fs.readFile(filePath, "utf8");
}

async function ensureRepairRepositoryBinding(input: {
  owner: string;
  repo: string;
  installationId: number;
}): Promise<void> {
  const repositoryFullName = `${input.owner}/${input.repo}`;
  const details = await getInstallationDetails(input.installationId);
  const authorizedAt = new Date().toISOString();

  await saveRepoInstallBinding({
    sessionKey: `repair:${repositoryFullName}`,
    installationId: input.installationId,
    installationOwner: details?.accountLogin ?? input.owner,
    installationOwnerType: details?.accountType ?? "User",
    repositoryFullName,
    setupAction: "update",
    authorizedAt,
  });

  await saveAspRepositoryInstallation({
    installationId: input.installationId,
    repositoryFullName,
    authorizedAt,
  });
}

export async function applyMeridianBaselineRepair(input: {
  owner: string;
  repo: string;
  repairId: string;
  installationId?: number;
}): Promise<RepositoryRepairResult> {
  if (input.repairId !== MERIDIAN_BASELINE_REPAIR_ID) {
    return {
      ok: false,
      repairId: input.repairId,
      branch: REPAIR_BRANCH,
      error: "Unknown repairId.",
    };
  }

  if (input.owner !== "velz-cmd" || input.repo !== "Meridian") {
    return {
      ok: false,
      repairId: input.repairId,
      branch: REPAIR_BRANCH,
      error: "Repair is only defined for velz-cmd/Meridian.",
    };
  }

  if (input.installationId) {
    await ensureRepairRepositoryBinding({
      owner: input.owner,
      repo: input.repo,
      installationId: input.installationId,
    });
  }

  const token = await resolveAspGitHubToken({
    owner: input.owner,
    repo: input.repo,
    installationId: input.installationId,
  });
  const client = new GitHubClient(token);
  const meta = await client.getRepo(input.owner, input.repo);
  const baseSha = await client.getBranchSha(input.owner, input.repo, meta.defaultBranch);

  const existingPrs = await client.listOpenPullRequestsForHeadPrefix(
    input.owner,
    input.repo,
    REPAIR_BRANCH
  );
  if (existingPrs.length > 0) {
    return {
      ok: true,
      repairId: input.repairId,
      branch: REPAIR_BRANCH,
      pullRequestUrl: existingPrs[0]!.url,
      pullRequestNumber: existingPrs[0]!.number,
      alreadyExisted: true,
    };
  }

  try {
    await client.createBranch(input.owner, input.repo, REPAIR_BRANCH, baseSha);
  } catch {
    /* branch may already exist */
  }

  for (const file of FILE_MAP) {
    const content = await readBundleFile(file.bundleName);
    await client.upsertFile(
      input.owner,
      input.repo,
      file.repoPath,
      REPAIR_BRANCH,
      content,
      `Repair Meridian baseline build (${file.repoPath})`
    );
  }

  const pr = await client.createPullRequest(
    input.owner,
    input.repo,
    "Repair Meridian baseline build blocker",
    REPAIR_BRANCH,
    meta.defaultBranch,
    PR_BODY
  );

  return {
    ok: true,
    repairId: input.repairId,
    branch: REPAIR_BRANCH,
    pullRequestUrl: pr.url,
    pullRequestNumber: pr.number,
  };
}
