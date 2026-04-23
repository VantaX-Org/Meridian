/**
 * Smoke tests for the aurora-writing classify function.
 *
 * Runnable via `node eslint-rules/aurora-writing.test.mjs` — no jest/vitest
 * needed, just node's built-in assert. Keeps the rule's pure logic covered
 * even if the full ESLint rule-tester isn't set up. Drop-in friendly for
 * WS8 pass 2 when @typescript-eslint/rule-tester lands.
 */

import assert from "node:assert/strict";
import { classify } from "./aurora-writing.mjs";

/* ── placeholder ────────────────────────────────────────────────────── */

assert.equal(classify(null), null, "non-string returns null");
assert.equal(classify(""), null, "empty string returns null");
assert.equal(classify("   "), null, "whitespace returns null");

assert.equal(classify("Loading…")?.messageId, "placeholder");
assert.equal(classify("Loading...")?.messageId, "placeholder");
assert.equal(classify("loading")?.messageId, "placeholder");
assert.equal(classify("OK")?.messageId, "placeholder");
assert.equal(classify("Submit")?.messageId, "placeholder");
assert.equal(classify("Cancel")?.messageId, "placeholder");
assert.equal(classify("Error")?.messageId, "placeholder");
assert.equal(classify("No data")?.messageId, "placeholder");
assert.equal(classify("Something went wrong")?.messageId, "glossary",
  "something went wrong is a glossary violation — takes the more specific rule");

/* ── voice (apologetic) ──────────────────────────────────────────────── */

assert.equal(classify("Oops")?.messageId, "voice");
assert.equal(classify("Oops, something broke")?.messageId, "voice");
assert.equal(classify("Sorry")?.messageId, "voice");
assert.equal(classify("Sorry, we couldn't connect")?.messageId, "voice");
assert.equal(classify("Welcome to Meridian")?.messageId, "voice");
assert.equal(classify("Uh-oh, no results")?.messageId, "voice");

/* ── glossary violations ─────────────────────────────────────────────── */

assert.equal(classify("Dashboard")?.messageId, "glossary");
assert.equal(classify("Your dashboard is ready")?.messageId, "glossary");
assert.equal(
  classify("Something went wrong with Ollama")?.messageId,
  "glossary",
  "'something went wrong' variants flagged as glossary",
);

/* ── clean strings ──────────────────────────────────────────────────── */

assert.equal(classify("Run analysis"), null);
assert.equal(classify("1,247 open issues across 4 modules"), null);
assert.equal(classify("Command Centre"), null);
assert.equal(classify("DQS dropped 4.2 points overnight"), null);
assert.equal(classify("Start scoring"), null);
assert.equal(classify("Publish report"), null);

/* ── edge cases ─────────────────────────────────────────────────────── */

// Case-insensitive prefix match
assert.equal(classify("OOPS")?.messageId, "voice");
// Whitespace-only tail after a prefix still caught
assert.equal(classify("Oops ")?.messageId, "voice");
// Longer valid string that happens to contain the word 'dashboard' mid-text
assert.equal(
  classify("Your dashboard user count dropped")?.messageId,
  "glossary",
  "dashboard anywhere in the sentence triggers glossary",
);

console.log("aurora-writing classify tests: all passed ✓");
