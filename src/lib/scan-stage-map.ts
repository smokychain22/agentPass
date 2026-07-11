import type { ScanPhase } from "@/lib/scanner/types";

export const STAGE_TO_PHASE: Record<string, ScanPhase> = {
  queued: "validating",
  validating_repository: "validating",
  resolving_branch: "resolving",
  downloading_archive: "fetching",
  extracting_archive: "unpacking",
  inventorying_files: "inventorying",
  detecting_frameworks: "detecting",
  detecting_project_roots: "detecting_roots",
  detecting_protected_paths: "detecting_protected",
  persisting_scan: "persisting",
  complete: "complete",
};
