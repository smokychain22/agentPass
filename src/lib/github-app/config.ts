import { buildNewInstallationUrl, getGitHubAppSlugOrThrow } from "./install-redirect";
import { getAppBaseUrl } from "./app-base-url";

export { getAppBaseUrl, resolveRepodietReturnUrl } from "./app-base-url";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readEnvAny(names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return undefined;
}

function decodePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return Buffer.from(trimmed, "base64").toString("utf8");
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    readEnv("GITHUB_APP_ID") &&
      readEnv("GITHUB_APP_CLIENT_ID") &&
      readEnv("GITHUB_APP_CLIENT_SECRET") &&
      readEnvAny(["GITHUB_APP_PRIVATE_KEY_BASE64", "GITHUB_APP_PRIVATE_KEY"]) &&
      readEnv("GITHUB_APP_SLUG")
  );
}

export function getGitHubAppConfig() {
  const appId = readEnv("GITHUB_APP_ID");
  const clientId = readEnv("GITHUB_APP_CLIENT_ID");
  const clientSecret = readEnv("GITHUB_APP_CLIENT_SECRET");
  const privateKeyRaw = readEnvAny(["GITHUB_APP_PRIVATE_KEY_BASE64", "GITHUB_APP_PRIVATE_KEY"]);
  const slug = readEnv("GITHUB_APP_SLUG");

  if (!appId || !clientId || !clientSecret || !privateKeyRaw || !slug) {
    throw new Error("GitHub App environment variables are not fully configured.");
  }

  const privateKey = decodePrivateKey(privateKeyRaw);

  return {
    appId,
    clientId,
    clientSecret,
    privateKey,
    slug,
    webhookSecret: readEnvAny(["GITHUB_APP_WEBHOOK_SECRET", "GITHUB_WEBHOOK_SECRET"]),
  };
}

export function getGitHubAppInstallUrl(state?: string): string {
  const slug = getGitHubAppSlugOrThrow();
  return buildNewInstallationUrl(slug, state);
}
