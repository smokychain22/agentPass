import { createHash, timingSafeEqual } from "node:crypto";
import type { A2ATaskRecord } from "@/lib/a2a/types";

export function hashTaskOwnerSession(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex");
}

export function directTaskBelongsToSession(
  task: A2ATaskRecord,
  sessionKey: string
): boolean {
  if (task.input.purchaseChannel !== "direct_site") return true;
  const expected = task.input.ownerSessionKeyHash;
  if (!expected) return false;
  const actual = hashTaskOwnerSession(sessionKey);
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export function assertDirectTaskOwner(task: A2ATaskRecord, sessionKey: string): void {
  if (!directTaskBelongsToSession(task, sessionKey)) {
    throw new Error("task_access_denied");
  }
}
