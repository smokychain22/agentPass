import assert from "node:assert/strict";
import {
  controlledDeliveryRejectReason,
  evaluateControlledDeliverySelection,
  isControlledDeliveryPreferredPath,
} from "../src/lib/cleanup/controlled-delivery-scope";
import { exactChargeLabelFromMicro, formatExactUsdtFromMicro } from "../src/lib/pricing/exact-amount";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("controlled-delivery-scope");

test("rejects runtime-hook and generated paths", () => {
  assert.equal(controlledDeliveryRejectReason("src/config/runtime-hook.ts"), "runtime/config path");
  assert.equal(
    controlledDeliveryRejectReason("src/generated/api-client.generated.ts"),
    "generated file"
  );
  assert.equal(isControlledDeliveryPreferredPath("src/unused/empty-module.ts"), true);
  assert.equal(isControlledDeliveryPreferredPath("src/unused/confirmed-unused.ts"), true);
});

test("evaluate blocks runtime-hook selection without preferred-path customer copy", () => {
  const gate = evaluateControlledDeliverySelection(["src/config/runtime-hook.ts"]);
  assert.equal(gate.allowed, false);
  assert.match(gate.message ?? "", /runtime\/config path|blocked/i);
  assert.doesNotMatch(gate.message ?? "", /Prefer src\/unused/i);
});

test("exact USDT label is unambiguous", () => {
  assert.equal(exactChargeLabelFromMicro("1000000"), "1.00 USDT");
  assert.equal(exactChargeLabelFromMicro("30000"), "0.03 USDT");
  const exact = formatExactUsdtFromMicro("1000000");
  assert.equal(exact.authorizeButtonLabel, "Authorize 1.00 USDT");
  assert.doesNotMatch(exact.authorizeButtonLabel, /negotiated/i);
});

console.log("controlled-delivery-scope: all passed");
