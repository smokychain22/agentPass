import stats from "./scan-stats.json";
import { DEMO_REPO_URL } from "./constants";

export type DemoScanStats = typeof stats;

export function getDemoScanStats(): DemoScanStats {
  return stats;
}

export function buildDemoTerminalLines() {
  const s = getDemoScanStats();
  const repoSlug = DEMO_REPO_URL.replace(/^https?:\/\//, "");

  return [
    { text: `$ repodiet scan ${repoSlug}`, className: "text-foreground" },
    { text: "", className: "" },
    { text: "Fetching repository...", className: "text-muted-foreground" },
    { text: `Framework: ${s.framework}`, className: "text-electric" },
    { text: `Package manager: ${s.packageManager}`, className: "text-electric" },
    { text: `Files indexed: ${s.filesIndexed}`, className: "text-electric" },
    { text: `Duplicate clusters: ${s.duplicateClusters}`, className: "text-electric" },
    { text: `Unused files: ${s.unusedFiles}`, className: "text-electric" },
    { text: `AI-slop signals: ${s.aiSlopSignals}`, className: "text-electric" },
    {
      text: s.patchBundleReady ? "Patch bundle: ready" : "Patch bundle: pending",
      className: "text-signal",
    },
  ];
}
