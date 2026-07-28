import { getDurableRecord, setDurableRecordIfAbsent } from "@/lib/store/durable-store";
import { getA2ATask, isTerminalStatus } from "./task-store";

export interface ActiveTaskLookup {
  /** False only when the lookup itself could not run — never conflated with "no task found". */
  lookupCompleted: boolean;
  found: boolean;
  taskId?: string;
  state?: string;
  terminal?: boolean;
  escrowId?: string;
  deliveryId?: string;
  createdAt?: string;
  updatedAt?: string;
  /** How the answer was obtained, so callers can judge how much it proves. */
  method: "idempotency_record" | "unavailable";
  lookupError?: string;
}

/**
 * Authoritative, READ-ONLY check for a paid A2A task that already covers a
 * given unit of work, so funding can never create a duplicate.
 *
 * Implementation note: the persistent store is strictly key-value by ID and
 * exposes no way to enumerate a collection, so this cannot scan all tasks.
 * Instead every funded task claims a record under its deterministic
 * idempotency key (buyer + seller + service + operation + repository +
 * branch + commit + plan + decision fingerprint + amount). Looking that key
 * up is O(1) and exact: if a task was ever created for this precise unit of
 * work through claimTaskIdempotencyKey(), the record exists.
 *
 * Safety contract: this distinguishes "checked and found nothing" from
 * "could not check". Callers must treat a failed lookup as a blocker, never
 * as an all-clear — an unknown duplicate state is exactly when double
 * funding happens.
 */
export async function findActiveCleanupTask(input: {
  idempotencyKey: string;
}): Promise<ActiveTaskLookup> {
  try {
    const record = await getDurableRecord<{ taskId: string; createdAt: string }>(
      "a2a_task_idempotency",
      input.idempotencyKey
    );

    if (!record?.taskId) {
      return { lookupCompleted: true, found: false, method: "idempotency_record" };
    }

    const task = await getA2ATask(record.taskId);
    if (!task) {
      // The claim exists but the task does not — treat as unknown rather
      // than clear, since we cannot prove no paid work happened.
      return {
        lookupCompleted: false,
        found: false,
        method: "unavailable",
        lookupError: `An idempotency claim references task ${record.taskId}, but that task record could not be read.`,
      };
    }

    const terminal = isTerminalStatus(task.status);
    return {
      lookupCompleted: true,
      // A terminal task no longer blocks new work; only live work does.
      found: !terminal,
      taskId: task.id,
      state: task.status,
      terminal,
      escrowId: task.result?.settlement?.escrowReference,
      deliveryId: task.result?.settlement?.deliveryId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      method: "idempotency_record",
    };
  } catch (err) {
    return {
      lookupCompleted: false,
      found: false,
      method: "unavailable",
      lookupError:
        err instanceof Error ? err.message : "Active-task lookup could not be completed.",
    };
  }
}

/**
 * Atomically claims the idempotency key for a task about to be created.
 * Returns false when another task already holds it, which callers must
 * treat as "a task already exists — do not create or fund a second one".
 *
 * This is the write half of the contract above and must be called before
 * any funding mutation.
 */
export async function claimTaskIdempotencyKey(
  idempotencyKey: string,
  taskId: string
): Promise<boolean> {
  return setDurableRecordIfAbsent("a2a_task_idempotency", idempotencyKey, {
    taskId,
    createdAt: new Date().toISOString(),
  });
}
