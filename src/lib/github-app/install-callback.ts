export type GitHubSetupAction = "install" | "update";

export const GITHUB_SETUP_ACTIONS: GitHubSetupAction[] = ["install", "update"];

export interface ParsedInstallCallback {
  installationId: number;
  setupAction: GitHubSetupAction;
  stateToken: string;
}

export type InstallCallbackValidation =
  | { ok: true; params: ParsedInstallCallback }
  | { ok: false; errorCode: string };

function readSearchParam(
  searchParams: URLSearchParams,
  key: string
): string | null {
  const value = searchParams.get(key)?.trim();
  return value || null;
}

export function parseInstallationId(raw: string | null): number | null {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const installationId = Number(raw);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return null;
  return installationId;
}

export function parseSetupAction(raw: string | null): GitHubSetupAction | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === "install" || normalized === "update") {
    return normalized;
  }
  return null;
}

export function parseInstallCallbackParams(
  searchParams: URLSearchParams
): InstallCallbackValidation {
  const installationIdRaw =
    readSearchParam(searchParams, "installation_id") ??
    readSearchParam(searchParams, "github_installation_id");
  const setupActionRaw = readSearchParam(searchParams, "setup_action");
  const stateToken = readSearchParam(searchParams, "state");

  if (!installationIdRaw) {
    return { ok: false, errorCode: "missing_installation" };
  }

  const installationId = parseInstallationId(installationIdRaw);
  if (installationId === null) {
    return { ok: false, errorCode: "invalid_installation" };
  }

  if (!setupActionRaw) {
    return { ok: false, errorCode: "missing_setup_action" };
  }

  const setupAction = parseSetupAction(setupActionRaw);
  if (!setupAction) {
    return { ok: false, errorCode: "invalid_setup_action" };
  }

  if (!stateToken) {
    return { ok: false, errorCode: "invalid_state" };
  }

  return {
    ok: true,
    params: {
      installationId,
      setupAction,
      stateToken,
    },
  };
}
