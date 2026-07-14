import ts from "typescript";
import type { ValidUnusedImportEvidence } from "./unused-import-evidence";

function scriptKindForPath(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".ts")) return ts.ScriptKind.TS;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function normalizeImportText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function specifierLocalName(spec: ts.ImportSpecifier): string {
  return spec.propertyName?.text ?? spec.name.text;
}

function importDeclarationText(node: ts.ImportDeclaration, sourceFile: ts.SourceFile): string {
  const start = node.getStart(sourceFile);
  const end = node.end;
  return sourceFile.text.slice(start, end).trim();
}

function symbolInImport(node: ts.ImportDeclaration, symbol: string): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.name?.text === symbol) return true;
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.some((el) => specifierLocalName(el) === symbol);
}

function findMatchingImportDeclaration(
  sourceFile: ts.SourceFile,
  importLine: string
): ts.ImportDeclaration | undefined {
  const normalized = normalizeImportText(importLine);
  let match: ts.ImportDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (match) return;
    if (ts.isImportDeclaration(node)) {
      const text = normalizeImportText(importDeclarationText(node, sourceFile));
      if (text === normalized) {
        match = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}

function removeSpecifierFromImport(
  source: string,
  importDecl: ts.ImportDeclaration,
  symbol: string,
  sourceFile: ts.SourceFile
): string | null {
  const clause = importDecl.importClause;
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return null;
  }

  const elements = clause.namedBindings.elements;
  const remaining = elements.filter((el) => specifierLocalName(el) !== symbol);
  if (remaining.length === elements.length) {
    return null;
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const start = importDecl.getStart(sourceFile);
  const end = importDecl.end;
  const indent = sourceFile.text.slice(start, importDecl.getStart(sourceFile, false)).match(/^\s*/)?.[0] ?? "";

  if (remaining.length === 0 && !clause.name) {
    return source.slice(0, start) + source.slice(end).replace(/^\n?/, "");
  }

  const newNamed = ts.factory.updateNamedImports(clause.namedBindings, remaining);
  const newClause = ts.factory.updateImportClause(
    clause,
    clause.isTypeOnly,
    clause.name,
    newNamed
  );
  const newImport = ts.factory.updateImportDeclaration(
    importDecl,
    importDecl.modifiers,
    newClause,
    importDecl.moduleSpecifier,
    importDecl.attributes
  );

  const printed = printer.printNode(ts.EmitHint.Unspecified, newImport, sourceFile).trim();
  const withSemicolon = printed.endsWith(";") ? printed : `${printed};`;
  return `${source.slice(0, start)}${indent}${withSemicolon}${source.slice(end)}`;
}

/** AST-only unused import specifier removal — never scans to the next semicolon. */
export function removeUnusedImportSpecifierAst(
  source: string,
  evidence: ValidUnusedImportEvidence
): string | null {
  const kind = scriptKindForPath(evidence.filePath);
  const sourceFile = ts.createSourceFile(
    evidence.filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );

  const importDecl = findMatchingImportDeclaration(sourceFile, evidence.importLine);
  if (!importDecl) return null;
  if (!symbolInImport(importDecl, evidence.symbol)) return null;

  return removeSpecifierFromImport(source, importDecl, evidence.symbol, sourceFile);
}

export function convertSymbolToTypeOnlyImportAst(
  source: string,
  evidence: ValidUnusedImportEvidence
): string | null {
  const kind = scriptKindForPath(evidence.filePath);
  const sourceFile = ts.createSourceFile(
    evidence.filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );

  const importDecl = findMatchingImportDeclaration(sourceFile, evidence.importLine);
  if (!importDecl?.importClause?.namedBindings || !ts.isNamedImports(importDecl.importClause.namedBindings)) {
    return null;
  }

  const elements = importDecl.importClause.namedBindings.elements.map((el) => {
    if (specifierLocalName(el) !== evidence.symbol) return el;
    if (el.isTypeOnly) return el;
    return ts.factory.updateImportSpecifier(el, true, el.propertyName, el.name);
  });

  const newNamed = ts.factory.updateNamedImports(importDecl.importClause.namedBindings, elements);
  const newClause = ts.factory.updateImportClause(
    importDecl.importClause,
    true,
    importDecl.importClause.name,
    newNamed
  );
  const newImport = ts.factory.updateImportDeclaration(
    importDecl,
    importDecl.modifiers,
    newClause,
    importDecl.moduleSpecifier,
    importDecl.attributes
  );

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const start = importDecl.getStart(sourceFile);
  const end = importDecl.end;
  const indent = sourceFile.text.slice(start, importDecl.getStart(sourceFile, false)).match(/^\s*/)?.[0] ?? "";
  const printed = printer.printNode(ts.EmitHint.Unspecified, newImport, sourceFile).trim();
  const withSemicolon = printed.endsWith(";") ? printed : `${printed};`;
  return `${source.slice(0, start)}${indent}${withSemicolon}${source.slice(end)}`;
}
