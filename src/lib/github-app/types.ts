export interface GitHubInstallationSession {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization" | string;
  connectedAt: string;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  configured: boolean;
  account?: {
    login: string;
    type: string;
  };
  permissions?: {
    contents: string;
    pullRequests: string;
    metadata: string;
  };
}

export interface InstallationTokenResult {
  token: string;
  expiresAt: string;
}
