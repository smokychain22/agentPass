import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });
export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  globalIgnores([
    ".next/**",
    ".repodiet-runtime/**",
    ".repodiet-okx-runtimes/**",
    "coverage/**",
    "worker/dist/**",
    "public/demo/**",
    "src/app/.well-known/workflow/**",
  ]),
]);
