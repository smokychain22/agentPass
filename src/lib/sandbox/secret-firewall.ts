/**
 * Secret firewall for untrusted customer code execution (install/build/test).
 * Trusted delivery (GitHub App token, signing) must run outside this env.
 */

const BLOCKED_ENV_PREFIXES = [
  "GITHUB_APP_",
  "OKX_",
  "RECEIPT_",
  "GREEN_PR_",
  "SUPABASE_",
  "UPSTASH_",
  "WORKER_",
  "REPODIET_INTERNAL_",
  "DATABASE_",
  "POSTGRES_",
  "AWS_",
  "VERCEL_OIDC",
];

const BLOCKED_ENV_EXACT = new Set([
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_INSTALLATION_TOKEN",
  "WORKER_API_KEY",
  "WORKER_CALLBACK_SECRET",
  "REPODIET_INTERNAL_DIAGNOSTIC_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "UPSTASH_REDIS_REST_TOKEN",
  "RECEIPT_SIGNING_PRIVATE_KEY",
  "GREEN_PR_SIGNING_PRIVATE_KEY",
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_PASSPHRASE",
]);

const ALLOWED_PASSTHROUGH = new Set([
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NODE_ENV",
  "npm_config_cache",
  "npm_config_user_agent",
  "CI",
]);

export function isBlockedSecretEnvKey(key: string): boolean {
  if (BLOCKED_ENV_EXACT.has(key)) return true;
  return BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Build an environment map safe to pass to untrusted customer package scripts.
 * Strips platform secrets; keeps minimal OS/npm path variables.
 */
export function buildUntrustedSandboxEnv(
  base: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value == null) continue;
    if (isBlockedSecretEnvKey(key)) continue;
    if (ALLOWED_PASSTHROUGH.has(key) || key.startsWith("npm_config_")) {
      out[key] = value;
    }
  }
  out.REPODIET_SANDBOX = "untrusted";
  out.NODE_OPTIONS = out.NODE_OPTIONS ?? "";
  return out;
}

export function assertNoSecretsInSandboxEnv(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    if (isBlockedSecretEnvKey(key)) {
      throw new Error(`Sandbox env leak blocked: ${key}`);
    }
  }
}
