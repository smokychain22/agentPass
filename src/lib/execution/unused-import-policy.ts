/** Unused-import auto-fix uses TypeScript AST only — never the legacy semicolon scanner. */
export function isUnusedImportAutoTransformEnabled(): boolean {
  return process.env.REPODIET_DISABLE_UNUSED_IMPORT_AUTOFIX !== "1";
}
