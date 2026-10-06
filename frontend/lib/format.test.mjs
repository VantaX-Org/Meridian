/** Run: `node lib/format.test.mjs` — node's built-in assert, same pattern as eslint-rules/aurora-writing.test.mjs. */
import assert from "node:assert/strict";
import { checkClassLabel, errorLabel, formatDate, humanizeIds, labelOf } from "./format.ts";

assert.equal(checkClassLabel("domain_value_check"), "Allowed values");
assert.equal(checkClassLabel("group_sum_check"), "Group total vs. limit");
assert.equal(checkClassLabel("older_than_days"), "Older than days");
assert.equal(checkClassLabel("toString"), "Tostring");

assert.equal(formatDate("2026-10-02T05:09:17Z"), "2 Oct 2026");
assert.equal(formatDate("2026-10-02T05:09:17Z", "datetime"), "2 Oct 2026, 05:09");
assert.equal(formatDate("2026-10-02T05:09:17"), "2 Oct 2026", "naive timestamps are UTC");
assert.equal(formatDate(null), "—");
assert.equal(formatDate("nope"), "—");
assert.equal(labelOf("not_yet_checked"), "Not yet checked");
assert.equal(labelOf("pending_approval"), "Pending approval");
assert.equal(labelOf("auth_failed"), "Sign-in refused");
assert.equal(labelOf("open"), "Open");
assert.equal(labelOf("in_progress"), "In progress");
assert.equal(labelOf("toString"), "Tostring");
assert.match(errorLabel("pyrfc_not_installed: build the wheel"), /^SAP RFC library/);
assert.equal(errorLabel("timeout_reached"), "Timeout Reached");
assert.equal(errorLabel(null), "—");
assert.equal(humanizeIds("1 module(s) in accounts_payable failed"), "1 module(s) in Accounts Payable failed");
console.log("format.test: ok");
