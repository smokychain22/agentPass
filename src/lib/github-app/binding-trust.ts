import type { RepoInstallBinding } from "./install-flow-store";

/** Trust a recent grant callback while GitHub propagates repository access. */
export const REPO_INSTALL_BINDING_TRUST_MS = 30 * 60 * 1000;

export function isRecentRepoInstallBinding(
  binding: RepoInstallBinding | undefined,
  installationId: number
): boolean {
  if (!binding || binding.installationId !== installationId) return false;
  const authorizedAt = Date.parse(binding.authorizedAt);
  if (!Number.isFinite(authorizedAt)) return false;
  const age = Date.now() - authorizedAt;
  return age >= 0 && age < REPO_INSTALL_BINDING_TRUST_MS;
}
