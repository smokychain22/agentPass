import { access } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeRepoRelativePath } from "./path-normalize";

const execFileAsync = promisify(execFile);

const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/i;
const MAX_LS_TREE_BUFFER = 64 * 1024 * 1024;

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface PinnedCommitTree {
  treeSha: string;
  entries: GitTreeEntry[];
}

function assertCommitSha(commitSha: string): void {
  if (!COMMIT_SHA_RE.test(commitSha)) {
    throw new Error(`invalid_commit_sha:${commitSha}`);
  }
}

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "RepoDiet",
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function isPathTerminalType(type: string): type is "blob" | "commit" {
  return type === "blob" || type === "commit";
}

/**
 * Resolve a pinned commit to its tree via the GitHub Git Data API, then list
 * recursive tree entries. Only blob and commit (gitlink) entries are returned
 * as path inventory terminals; nested trees are not path terminals.
 */
export async function fetchPinnedCommitTreeViaApi(
  owner: string,
  repo: string,
  commitSha: string,
  options?: { token?: string; fetchImpl?: typeof fetch }
): Promise<PinnedCommitTree> {
  assertCommitSha(commitSha);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const headers = githubHeaders(options?.token);

  const commitUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(commitSha)}`;
  const commitRes = await fetchImpl(commitUrl, { headers });
  if (!commitRes.ok) {
    throw new Error(
      `github_commit_fetch_failed:${commitRes.status}:${owner}/${repo}@${commitSha}`
    );
  }
  const commitBody = (await commitRes.json()) as {
    tree?: { sha?: string };
  };
  const treeSha = commitBody.tree?.sha;
  if (!treeSha || !COMMIT_SHA_RE.test(treeSha)) {
    throw new Error(`github_commit_missing_tree:${owner}/${repo}@${commitSha}`);
  }

  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`;
  const treeRes = await fetchImpl(treeUrl, { headers });
  if (!treeRes.ok) {
    throw new Error(
      `github_tree_fetch_failed:${treeRes.status}:${owner}/${repo}@${treeSha}`
    );
  }
  const treeBody = (await treeRes.json()) as {
    sha?: string;
    truncated?: boolean;
    tree?: Array<{
      path?: string;
      mode?: string;
      type?: string;
      sha?: string;
      size?: number;
    }>;
  };
  if (treeBody.truncated) {
    throw new Error(`github_tree_truncated:${owner}/${repo}@${treeSha}`);
  }

  const entries: GitTreeEntry[] = [];
  for (const raw of treeBody.tree ?? []) {
    if (!raw.path || !raw.mode || !raw.type || !raw.sha) continue;
    if (!isPathTerminalType(raw.type)) continue;
    const pathExact = normalizeRepoRelativePath(raw.path);
    entries.push({
      path: pathExact,
      mode: raw.mode,
      type: raw.type,
      sha: raw.sha,
      ...(typeof raw.size === "number" ? { size: raw.size } : {}),
    });
  }

  return { treeSha: treeBody.sha ?? treeSha, entries };
}

/**
 * Parse `git ls-tree -r -z --full-tree -l <commit>` output.
 * Records are `MODE TYPE SHA SIZE\tPATH\0` or `MODE TYPE SHA\tPATH\0`
 * (size may be `-` for gitlinks). Multiple spaces may pad the size field.
 */
export function parseGitLsTreeZ(buffer: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  let start = 0;
  for (let i = 0; i <= buffer.length; i++) {
    if (i < buffer.length && buffer[i] !== 0) continue;
    if (i === start) {
      start = i + 1;
      continue;
    }
    const record = buffer.subarray(start, i).toString("utf8");
    start = i + 1;
    if (!record) continue;

    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const meta = record.slice(0, tab);
    const rawPath = record.slice(tab + 1);
    const match = meta.match(
      /^([0-7]{5,6})\s+(blob|tree|commit)\s+([0-9a-f]{7,40})(?:\s+(-|[0-9]+))?$/i
    );
    if (!match) continue;
    const [, mode, type, sha, sizeRaw] = match;
    if (!isPathTerminalType(type)) continue;
    const pathExact = normalizeRepoRelativePath(rawPath);
    const entry: GitTreeEntry = {
      path: pathExact,
      mode,
      type,
      sha,
    };
    if (sizeRaw && sizeRaw !== "-") {
      const size = Number(sizeRaw);
      if (Number.isFinite(size)) entry.size = size;
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * List path-terminal entries for a pinned commit via local `git ls-tree`.
 * Uses execFile (argv array) — never shell-concatenates paths.
 */
export async function listPinnedCommitTreeViaGit(
  repoDir: string,
  commitSha: string
): Promise<PinnedCommitTree> {
  assertCommitSha(commitSha);

  const { stdout: revStdout } = await execFileAsync(
    "git",
    ["-C", repoDir, "rev-parse", `${commitSha}^{tree}`],
    { encoding: "utf8", maxBuffer: 1024 * 1024 }
  );
  const treeSha = revStdout.trim();
  if (!COMMIT_SHA_RE.test(treeSha)) {
    throw new Error(`git_rev_parse_tree_failed:${commitSha}`);
  }

  const { stdout } = await execFileAsync(
    "git",
    ["-C", repoDir, "ls-tree", "-r", "-z", "--full-tree", "-l", commitSha],
    { encoding: "buffer", maxBuffer: MAX_LS_TREE_BUFFER }
  );

  const entries = parseGitLsTreeZ(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
  return { treeSha, entries };
}

async function hasGitDir(repoDir: string): Promise<boolean> {
  try {
    await access(path.join(repoDir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer local git when `repoDir` contains `.git`; otherwise use the GitHub API.
 */
export async function loadPinnedCommitTree(options: {
  owner: string;
  repo: string;
  commitSha: string;
  repoDir?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<PinnedCommitTree & { source: "git" | "api" }> {
  if (options.repoDir && (await hasGitDir(options.repoDir))) {
    const tree = await listPinnedCommitTreeViaGit(options.repoDir, options.commitSha);
    return { ...tree, source: "git" };
  }
  const tree = await fetchPinnedCommitTreeViaApi(
    options.owner,
    options.repo,
    options.commitSha,
    { token: options.token, fetchImpl: options.fetchImpl }
  );
  return { ...tree, source: "api" };
}
