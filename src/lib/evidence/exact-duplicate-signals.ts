/**
 * Exact file-duplicate evidence uses `exact_file_duplicate=true` from
 * enrich-exact-duplicates. Older paths may also emit `exact_duplicate=true`.
 * Both identify byte-identical file consolidation candidates.
 */
export function hasExactDuplicateSignal(signals: readonly string[]): boolean {
  return signals.some(
    (signal) =>
      signal === "exact_file_duplicate=true" ||
      signal === "exact_duplicate=true" ||
      signal.startsWith("exact_file_duplicate=true") ||
      signal.startsWith("exact_duplicate=true")
  );
}
