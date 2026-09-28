import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract, LIMITS } from "../lib/transcript.mjs";
import { renderLedger, injectionText, MAX_LEDGER_CHARS } from "../lib/ledger.mjs";
import { redact } from "../lib/redact.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const jsonl = fs.readFileSync(path.join(here, "fixture", "session.jsonl"), "utf8");

test("redact removes common secret shapes and keeps the rest", () => {
  assert.equal(redact("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ok"), "token [redacted] ok");
  assert.equal(redact("export API_KEY=sk-live-0123456789abcdefghij && npm test"), "export API_KEY=[redacted] && npm test");
  assert.equal(redact("Authorization: Bearer abc.def.ghi123"), "Authorization: Bearer [redacted]");
  assert.match(redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"), /^\[redacted\]$/);
  assert.equal(redact("password=hunter2!!"), "password=[redacted]");
  assert.equal(redact("git commit -m 'fix login loop'"), "git commit -m 'fix login loop'");
  assert.equal(redact("AKIAIOSFODNN7EXAMPLE"), "[redacted]");
});

test("ledger renders every section and redacts secrets in prompts and commands", () => {
  const text = renderLedger(extract(jsonl), { when: "2026-09-28T02:00:00Z", trigger: "manual" });
  assert.match(text, /^# Carryover ledger\n/);
  assert.match(text, /Written before compaction \(manual\) at 2026-09-28T02:00:00Z/);
  assert.match(text, /Session: Fix the login redirect loop/);
  assert.match(text, /Branch: fix\/login/);
  assert.match(text, /1\. "Fix the redirect loop on \/login/);
  assert.match(text, /2\. "Also keep the fix under 20 lines\. My token is \[redacted\] by the way\."/);
  assert.match(text, /- \[x\] Find the redirect source/);
  assert.match(text, /- \[~\] Guard against expired cookie loop/);
  assert.match(text, /- \[ \] Add regression test/);
  assert.match(text, /- \/work\/app\/src\/auth\/middleware\.ts \(2 edits\)/);
  assert.match(text, /`export API_KEY=\[redacted\] && npm test`/);
  assert.match(text, /## Last assistant message before compaction\nThe guard is in place/);
  assert.doesNotMatch(text, /ghp_|sk-live/);
});

test("ledger keeps the first prompt and the most recent ones when there are many", () => {
  const d = extract(jsonl);
  d.prompts = Array.from({ length: 30 }, (_, i) => ({ text: `prompt number ${i + 1}`, ts: "" }));
  const text = renderLedger(d);
  assert.match(text, /1\. "prompt number 1"/);
  assert.match(text, /… 18 earlier message\(s\) omitted …/);
  assert.doesNotMatch(text, /"prompt number 2"/);
  assert.match(text, /30\. "prompt number 30"/);
  assert.equal((text.match(/^\d+\. "/gm) || []).length, LIMITS.maxPrompts);
});

test("ledger never exceeds the size cap and drops low-priority sections first", () => {
  const d = extract(jsonl);
  d.lastAssistant = "x".repeat(LIMITS.lastAssistantChars);
  d.commands = Array.from({ length: LIMITS.maxCommands }, (_, i) => `cmd ${i} ${"y".repeat(200)}`);
  d.files = Array.from({ length: 40 }, (_, i) => ({ path: `/very/long/path/${"z".repeat(150)}/${i}.ts`, count: 1 }));
  d.prompts = Array.from({ length: 12 }, (_, i) => ({ text: `${i} ${"w".repeat(690)}`, ts: "" }));
  const text = renderLedger(d);
  assert.ok(text.length <= MAX_LEDGER_CHARS + 1, `${text.length} chars`);
  assert.match(text, /The user's instructions, verbatim/);
  assert.match(text, /Task list at compaction time/);
  assert.doesNotMatch(text, /Last assistant message/);
});

test("injection text frames the ledger for the model", () => {
  const out = injectionText("# Carryover ledger\nbody\n");
  assert.match(out, /^Context was just compacted\./);
  assert.match(out, /trust the ledger/);
  assert.match(out, /# Carryover ledger\nbody$/);
});
