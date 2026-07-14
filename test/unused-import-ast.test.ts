import assert from "node:assert/strict";
import { removeUnusedImportSpecifierAst } from "../src/lib/execution/unused-import-ast";
import { validateTransformedSourceSyntax } from "../src/lib/execution/validate-transform-syntax";

const source = `import { used, unused } from "./lib";

export function main() {
  return used();
}
`;

const evidence = {
  importLine: 'import { used, unused } from "./lib";',
  symbol: "unused",
  filePath: "src/example.ts",
};

const modified = removeUnusedImportSpecifierAst(source, evidence);
assert.ok(modified);
assert.match(modified!, /import \{ used \}/);
assert.ok(!modified!.includes("unused"));

const syntax = validateTransformedSourceSyntax({
  filePath: "src/example.ts",
  originalSource: source,
  transformedSource: modified!,
});
assert.equal(syntax.ok, true);

console.log("unused-import-ast: all passed");
