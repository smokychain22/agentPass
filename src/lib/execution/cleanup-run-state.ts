export type CleanupRunState =
  | "created"
  | "preparing_workspace"
  | "running_baseline"
  | "selecting_finding"
  | "generating_change"
  | "validating_patch"
  | "running_verification"
  | "retained"
  | "skipped"
  | "rejected"
  | "completed"
  | "failed";

export interface CleanupStateTransition {
  state: CleanupRunState;
  at: string;
  detail?: string;
}

export class CleanupRunStateMachine {
  readonly transitions: CleanupStateTransition[] = [];

  constructor() {
    this.emit("created");
  }

  emit(state: CleanupRunState, detail?: string): void {
    this.transitions.push({ state, at: new Date().toISOString(), detail });
  }

  current(): CleanupRunState {
    return this.transitions[this.transitions.length - 1]?.state ?? "created";
  }
}
