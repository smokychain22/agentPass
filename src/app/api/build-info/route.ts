import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Safe public deployment metadata — no secrets or env values. */
export async function GET() {
  const gitCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown";
  const gitBranch = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GIT_BRANCH ?? "unknown";
  const environment =
    process.env.VERCEL_ENV === "production"
      ? "production"
      : process.env.VERCEL_ENV === "preview"
        ? "preview"
        : process.env.NODE_ENV === "production"
          ? "production"
          : "development";

  return NextResponse.json({
    gitCommit,
    gitBranch,
    environment,
    builtAt: new Date().toISOString(),
  });
}
