import {
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import type { PersistedRepositoryGraph, RepositoryGraphIdentity } from "./types";
import { repositoryGraphId } from "./types";

const COLLECTION = "repository_graphs" as const;

export async function getRepositoryGraph(
  id: string
): Promise<PersistedRepositoryGraph | undefined> {
  return getPersistentRecord<PersistedRepositoryGraph>(COLLECTION, id);
}

export async function getRepositoryGraphByIdentity(
  identity: RepositoryGraphIdentity
): Promise<PersistedRepositoryGraph | undefined> {
  return getRepositoryGraph(repositoryGraphId(identity));
}

export async function saveRepositoryGraph(
  graph: PersistedRepositoryGraph
): Promise<PersistedRepositoryGraph> {
  const next = { ...graph, updatedAt: new Date().toISOString() };
  await setPersistentRecord(COLLECTION, next.id, next);
  await setPersistentRecord(
    COLLECTION,
    `latest:${next.identity.repository}:${next.identity.projectRoot}`,
    next.id
  );
  return next;
}

export async function getLatestRepositoryGraph(
  repository: string,
  projectRoot = "."
): Promise<PersistedRepositoryGraph | undefined> {
  const id = await getPersistentRecord<string>(
    COLLECTION,
    `latest:${repository}:${projectRoot}`
  );
  if (!id) return undefined;
  return getRepositoryGraph(id);
}
