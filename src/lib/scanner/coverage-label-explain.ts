/**
 * Meridian incident coverage explanation (scan_cO1d_RoCMjNn).
 *
 * The Findings/Scan page previously showed two different numbers both labeled
 * "Analyzable source":
 *
 * - 407 = coverage.contract.supportedSourceFiles / filesAnalyzable
 *         (inventory files classified as supported JS/TS source)
 * - 473 = repositoryModel.analyzableSourceFiles
 *         (all relative paths matching JS/TS extensions in the file tree,
 *         including paths not in the supported_source inventory kind)
 *
 * Those are different categories. The UI now labels them distinctly:
 * - Supported JS/TS source files
 * - Analyzed source files
 *
 * "9 folders" was inventory.topLevelFolders.length (top-level only), not a
 * recursive directory count — now labeled "Top-level folders".
 */
export const MERIDIAN_INCIDENT_COVERAGE_EXPLAIN = {
  structureScanId: "scan_cO1d_RoCMjNn",
  sourceCommit: "a35631c6748d6619b9301a02b34f2ff99eecd5b7",
  supportedJsTsSource: 407,
  repositoryModelAnalyzablePaths: 473,
  whyDifferent:
    "407 counts inventory.supported_source; 473 counted JS/TS path extensions in repositoryModel — different fields, same wrong label.",
  topLevelFoldersLabel: "Top-level folders (not recursive total directories)",
} as const;
