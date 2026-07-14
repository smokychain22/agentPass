import { installationIdLastFour } from "@/lib/github-app/authoritative-access";

export function safeCallbackDiagnostics(input: {
  setupAction?: string;
  installationId?: number;
  callbackOrigin?: string;
  repository?: string;
  stateValid?: boolean;
  persistenceResult?: string;
  postCallbackState?: string;
}): Record<string, string | boolean | undefined> {
  return {
    setup_action: input.setupAction,
    installation_id_present: Boolean(input.installationId),
    installation_id_last4: installationIdLastFour(input.installationId),
    callback_origin: input.callbackOrigin,
    requested_repository: input.repository,
    state_validation_result: input.stateValid ? "valid" : "invalid",
    persistence_result: input.persistenceResult,
    post_callback_repository_access: input.postCallbackState,
  };
}
