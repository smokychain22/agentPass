import path from "node:path";

/** Shared env for analyzer CLI child processes on Vercel/serverless. */
export function analyzerChildEnv(): NodeJS.ProcessEnv {
  const appNodeModules = path.join(process.cwd(), "node_modules");
  const existing = process.env.NODE_PATH ?? "";
  const nodePath = existing
    ? `${appNodeModules}${path.delimiter}${existing}`
    : appNodeModules;
  return { ...process.env, FORCE_COLOR: "0", NODE_PATH: nodePath };
}

/**
 * Knip on Node 22+ enables oxc-parser raw transfer (~6 GiB buffer per worker).
 * That fails on memory-constrained hosts (Vercel lambdas, Windows) with:
 *   RangeError: Array buffer allocation failed
 * See: https://knip.dev/reference/known-issues
 */
export function knipChildEnv(): NodeJS.ProcessEnv {
  return {
    ...analyzerChildEnv(),
    KNIP_DISABLE_RAW_TRANSFER: "1",
  };
}

export function isKnipOomError(stderrOrMessage: string): boolean {
  const text = stderrOrMessage.toLowerCase();
  return (
    text.includes("array buffer allocation failed") ||
    text.includes("rangeerror: array buffer allocation failed")
  );
}
