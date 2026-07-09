import madge from "madge";
import path from "node:path";

const rootDir = process.argv[2];
const entry = process.argv[3];

if (!rootDir || !entry) {
  console.error(JSON.stringify({ error: "Missing rootDir or entry" }));
  process.exit(1);
}

try {
  const tsConfig = path.join(rootDir, "tsconfig.json");
  const result = await madge(entry, {
    fileExtensions: ["js", "ts", "tsx", "jsx", "mjs", "cjs"],
    excludeRegExp: [/node_modules/, /\.next/, /dist/, /build/, /coverage/, /\.cache/],
    tsConfig,
  });
  console.log(
    JSON.stringify({
      orphans: result.orphans().map((f) => f.replace(/\\/g, "/")),
      circular: result.circular(),
    })
  );
} catch (err) {
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
}
