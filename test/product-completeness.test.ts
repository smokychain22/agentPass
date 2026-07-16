import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("homepage gives buyers a production-oriented primary journey", () => {
  const hero = read("src/components/landing/hero-cta.tsx");
  const content = read("src/lib/marketing/content.ts");
  assert.match(hero, /Analyze a Repository/);
  assert.match(hero, /How RepoDiet Works/);
  assert.doesNotMatch(hero, /Watch Live Demo/);
  assert.match(content, /Turn repository debt into a verified cleanup pull request/);
});

test("how-it-works page explains real delivery and marks roadmap honestly", () => {
  const page = read("src/app/how-it-works/page.tsx");
  assert.match(page, /Create pull request/);
  assert.match(page, /RepoDiet never merges it automatically/);
  assert.match(page, /A2MCP diagnoses; A2A delivers/);
  assert.match(page, /These are roadmap/);
});

test("buyer explicitly approves proposed changes before PR creation", () => {
  const flow = read("src/components/app/fix-pr/fix-pr-a2a-flow.tsx");
  assert.match(flow, /Approve changes and create pull request/);
  assert.match(flow, /Review Pull Request/);
  assert.doesNotMatch(flow, /if \(\s*task\.status === "awaiting_approval"/);
});

test("workspace step names describe user outcomes", () => {
  const rail = read("src/components/app/shell/workflow-rail.tsx");
  for (const label of [
    "Connect Repository",
    "Review Findings",
    "Create Cleanup PR",
    "Review & Accept",
  ]) {
    assert.match(rail, new RegExp(label));
  }
});
