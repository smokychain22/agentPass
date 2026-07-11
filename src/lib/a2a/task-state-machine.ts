import type { A2ATaskStatus, A2ATaskTransition, InternalRole } from "./types";

export class A2ATaskStateMachine {
  readonly transitions: A2ATaskTransition[] = [];

  constructor(existing?: A2ATaskTransition[]) {
    if (existing?.length) {
      this.transitions = [...existing];
    } else {
      this.emit("submitted", "orchestrator");
    }
  }

  emit(status: A2ATaskStatus, role: InternalRole, detail?: string): void {
    this.transitions.push({
      status,
      at: new Date().toISOString(),
      role,
      detail,
    });
  }

  current(): A2ATaskStatus {
    return this.transitions[this.transitions.length - 1]?.status ?? "submitted";
  }

  cloneTransitions(): A2ATaskTransition[] {
    return [...this.transitions];
  }
}
