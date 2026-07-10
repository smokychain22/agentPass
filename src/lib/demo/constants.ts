/** Canonical demo repo URL shown in UI and terminal preview. */
export const DEMO_REPO_URL = "https://github.com/repodiet/demo-slop-app";

export const DEMO_REPO_OWNER = "repodiet";
export const DEMO_REPO_NAME = "demo-slop-app";
export const DEMO_REPO_BRANCH = "main";

export const DEMO_NOTICE =
  "Demo repo contains intentional AI-code-bloat patterns for testing RepoDiet.";

export const SAMPLE_BUNDLE_LABEL = "Sample bundle generated from demo repo";

/** Relative path from project root to the seeded demo workspace. */
export const DEMO_REPO_LOCAL_RELATIVE = "demo-repos/repodiet-demo-slop-app";

const DEMO_URL_PATTERNS = [
  DEMO_REPO_URL.toLowerCase(),
  "github.com/repodiet/demo-slop-app",
  "repodiet-demo-slop-app",
  "demo-slop-app",
];

export function isDemoRepoUrl(repoUrl: string): boolean {
  const normalized = repoUrl.trim().toLowerCase();
  return DEMO_URL_PATTERNS.some((pattern) => normalized.includes(pattern));
}
