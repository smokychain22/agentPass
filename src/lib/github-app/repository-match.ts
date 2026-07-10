export function normalizeRepositoryFullName(owner: string, repo: string): string {
  return `${owner.trim()}/${repo.trim()}`;
}

export function repositoryFullNamesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function repositoryFullNameInList(
  repositories: string[],
  owner: string,
  repo: string
): boolean {
  const target = normalizeRepositoryFullName(owner, repo);
  return repositories.some((fullName) => repositoryFullNamesMatch(fullName, target));
}
