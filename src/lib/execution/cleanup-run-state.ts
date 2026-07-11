export type CleanupRunState =
  | "created"
  | "queued"
  | "modeling_repository"
  | "ranking_candidates"
  | "preparing_workspace"
  | "running_baseline"
  | "selecting_finding"
  | "generating_change"
  | "validating_change"
  | "validating_patch"
  | "running_targeted_checks"
  | "running_repository_checks"
  | "running_verification"
  | "retaining_change"
  | "rolling_back"
  | "trying_next_candidate"
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
    this.emit("queued");
  }

  emit(state: CleanupRunState, detail?: string): void {
    this.transitions.push({ state, at: new Date().toISOString(), detail });
  }

  current(): CleanupRunState {
    return this.transitions[this.transitions.length - 1]?.state ?? "created";
  }
}
