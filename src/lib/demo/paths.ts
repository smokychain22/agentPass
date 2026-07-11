import path from "node:path";
import { DEMO_REPO_LOCAL_RELATIVE } from "./constants";

export function getDemoRepoLocalPath(): string {
  return path.join(process.cwd(), DEMO_REPO_LOCAL_RELATIVE);
}

export function getDemoStatsPath(): string {
  return path.join(process.cwd(), "src/lib/demo/scan-stats.json");
}

export function getDemoBundlePath(): string {
  return path.join(process.cwd(), "public/demo/repodiet-demo-sample-bundle.zip");
}
