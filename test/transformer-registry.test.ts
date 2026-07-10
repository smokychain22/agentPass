import assert from "node:assert/strict";
import { listAutomaticTransformers } from "../src/lib/execution/transformer-registry";

assert.ok(listAutomaticTransformers().length >= 5);
assert.ok(listAutomaticTransformers().every((t) => t.requiredChecks.length > 0 || !t.automatic));
console.log("transformer-registry.test.ts: ok");
