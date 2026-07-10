function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    readEnv("GITHUB_APP_ID") &&
      readEnv("GITHUB_APP_CLIENT_ID") &&
      readEnv("GITHUB_APP_CLIENT_SECRET") &&
      readEnv("GITHUB_APP_PRIVATE_KEY_BASE64") &&
      readEnv("GITHUB_APP_SLUG")
  );
}

export function getGitHubAppConfig() {
  const appId = readEnv("GITHUB_APP_ID");
  const clientId = readEnv("GITHUB_APP_CLIENT_ID");
  const clientSecret = readEnv("GITHUB_APP_CLIENT_SECRET");
  const privateKeyBase64 = readEnv("GITHUB_APP_PRIVATE_KEY_BASE64");
  const slug = readEnv("GITHUB_APP_SLUG");

  if (!appId || !clientId || !clientSecret || !privateKeyBase64 || !slug) {
    throw new Error("GitHub App environment variables are not fully configured.");
  }

  const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf8");

  return {
    appId,
    clientId,
    clientSecret,
    privateKey,
    slug,
    webhookSecret: readEnv("GITHUB_APP_WEBHOOK_SECRET"),
  };
}

export function getGitHubAppInstallUrl(state?: string): string {
  const { slug } = getGitHubAppConfig();
  const base = `https://github.com/apps/${slug}/installations/new`;
  if (!state) return base;
  return `${base}?state=${encodeURIComponent(state)}`;
}

export function getAppBaseUrl(): string {
  const explicit = readEnv("NEXT_PUBLIC_APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = readEnv("VERCEL_URL");
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}
