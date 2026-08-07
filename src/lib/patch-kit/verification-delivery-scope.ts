/**
 * Resolves the EXACT set of operations repository verification should apply.
 *
 * === Why this module exists ===
 *
 * The cleanup pipeline used to run in this order:
 *
 *   analyze -> candidates -> merged patch -> VERIFY -> approval filter -> PR
 *
 * so verification ran against the whole analyzer candidate set, and the
 * approval/delivery filter ran afterwards inside `createCleanupPullRequest`.
 * An analyzer false positive that was never going to be delivered was still
 * applied to the verified tree. If it broke the customer repository's own
 * tests, `verifiedChanges` fell to 0 and an unrelated, genuinely-safe approved
 * candidate could never be delivered.
 *
 * Observed against `velz-cmd/repodiet-e2e-test`: the kit proposed deleting
 * `src/config/runtime-hook.ts`, which that repository references dynamically
 * through `fixture.config.json` — a real false positive. The approved
 * candidate was `src/repodiet-verification-unused.js`, genuinely unreferenced.
 * Verification applied both, the repository's own
 * `dynamic, side-effect, config, package-export and asset references stay
 * alive` test failed, and no PR could ever be produced. The base branch passes
 * its own tests cleanly, so this was not a pre-existing failure.
 *
 * The corrected order is:
 *
 *   analyze -> candidates -> classify/block -> APPROVAL SCOPE
 *           -> exact delivery operations -> VERIFY THOSE -> PR
 *
 * === What this does NOT do ===
 *
 * It does not weaken the safety model. A candidate that IS selected for
 * delivery is still applied to the verified tree and must still survive the
 * customer repository's own tests; if it does not, delivery still fails
 * closed. The only behaviour that changes is that an UNSELECTED candidate can
 * no longer invalidate a deliverable it has nothing to do with.
 *
 * It is also deliberately generic. Nothing here knows about the controlled
 * verification repository, `fixture.config.json`, or any specific path — the
 * scope is derived purely from the analyzer's own change operations and the
 * caller's approval list, so it behaves identically for arbitrary customer
 * repositories.
 */
import { filterOperatorSafeDeletes } from "@/lib/operator/safety";

export interface VerificationEdit {
  path: string;
  content: string;
  baselineContentHash?: string;
}

export interface VerificationDeliveryScope {
  /** Content edits that will actually be delivered. */
  edits: VerificationEdit[];
  /** Deletions that will actually be delivered. */
  deletePaths: string[];
  /** Candidate deletions excluded from delivery, and therefore from verification. */
  excludedDeletePaths: string[];
}

function normalize(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = normalize(raw);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Mirrors `resolveValidatedDeliveryOps`'s delete selection: a deletion ships
 * only if it is in the narrow unattended operator-safe set, or the caller
 * explicitly approved that exact path for this piece of work.
 *
 * Kept in this module rather than imported from the operator layer because the
 * engine must compute the scope BEFORE a `PatchKitPayload` exists — which is
 * precisely the ordering problem being fixed. `filterOperatorSafeDeletes` is
 * shared, so the two paths cannot drift on what "operator-safe" means.
 */
export function resolveVerificationDeliveryScope(input: {
  /** Analyzer change operations, if the engine produced any. */
  changeOperations?: Array<{ type: string; filePath: string }>;
  /** Candidate edits; an empty-content edit encodes a deletion. */
  edits: VerificationEdit[];
  /** Paths the caller explicitly approved for deletion. */
  approvedDeletePaths?: string[];
}): VerificationDeliveryScope {
  const edits = input.edits ?? [];
  const approved = new Set(unique(input.approvedDeletePaths ?? []));

  const fromOps =
    input.changeOperations?.filter((op) => op.type === "delete").map((op) => op.filePath) ?? [];
  const fromEmptyEdits = edits.filter((e) => e.content === "").map((e) => e.path);
  const candidateDeletes = unique([...fromOps, ...fromEmptyEdits]);

  const allowed = new Set(
    unique([
      ...filterOperatorSafeDeletes(candidateDeletes),
      ...candidateDeletes.filter((p) => approved.has(normalize(p))),
    ])
  );

  const excludedDeletePaths = candidateDeletes.filter((p) => !allowed.has(p));

  /**
   * Empty-content edits ARE deletions. An excluded deletion must therefore be
   * dropped from the edit list too — otherwise verification would faithfully
   * exclude it from `deletePaths` and then reintroduce it by writing the file
   * empty, which breaks the repository just as effectively as deleting it.
   */
  const excluded = new Set(excludedDeletePaths);
  const deliveredEdits = edits.filter(
    (e) => !(e.content === "" && excluded.has(normalize(e.path)))
  );

  return {
    edits: deliveredEdits,
    deletePaths: [...allowed],
    excludedDeletePaths,
  };
}
