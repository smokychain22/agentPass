import jwt from "jsonwebtoken";
import { getGitHubAppConfig } from "./config";

const JWT_TTL_SECONDS = 9 * 60;

export function createGitHubAppJwt(): string {
  const { appId, privateKey } = getGitHubAppConfig();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60,
      exp: now + JWT_TTL_SECONDS,
      iss: appId,
    },
    privateKey,
    { algorithm: "RS256" }
  );
}
