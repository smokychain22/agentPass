import path from "node:path";

/** Ensure analyzer child processes resolve app-level node_modules on Vercel. */
export function analyzerChildEnv(): NodeJS.ProcessEnv {
  const appNodeModules = path.join(process.cwd(), "node_modules");
  const existing = process.env.NODE_PATH ?? "";
  const nodePath = existing
    ? `${appNodeModules}${path.delimiter}${existing}`
    : appNodeModules;
  return { ...process.env, FORCE_COLOR: "0", NODE_PATH: nodePath };
}
