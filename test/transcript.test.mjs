import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "../lib/transcript.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const jsonl = fs.readFileSync(path.join(here, "fixture", "session.jsonl"), "utf8");

test("extract keeps only typed human prompts, in order", () => {
  const d = extract(jsonl);
  assert.equal(d.prompts.length, 2);
  assert.match(d.prompts[0].text, /^Fix the redirect loop/);
  assert.match(d.prompts[1].text, /^Also keep the fix under 20 lines/);
});

test("extract drops meta, tool results, slash commands, and compact summaries", () => {
  const d = extract(jsonl);
  for (const p of d.prompts) {
    assert.doesNotMatch(p.text, /system-reminder|command-name|tool_result/);
  }
});

test("extract collects edited files most recent first with counts, skipping subagents", () => {
  const d = extract(jsonl);
  assert.deepEqual(d.files, [
    { path: "/work/app/src/auth/middleware.ts", count: 2 },
    { path: "/work/app/src/auth/__tests__/loop.test.ts", count: 1 },
  ]);
});

test("extract collects distinct recent commands in order", () => {
  const d = extract(jsonl);
  assert.deepEqual(d.commands, [
    "grep -rn redirect src/auth",
    "export API_KEY=sk-live-0123456789abcdefghij && npm test",
    "npm test",
  ]);
});

test("extract keeps the latest TodoWrite, the last assistant text, and session metadata", () => {
  const d = extract(jsonl);
  assert.equal(d.todos.length, 3);
  assert.equal(d.todos[1].status, "in_progress");
  assert.match(d.lastAssistant, /^The guard is in place/);
  assert.equal(d.title, "Fix the login redirect loop");
  assert.equal(d.cwd, "/work/app");
  assert.equal(d.branch, "fix/login");
  assert.equal(d.compactions, 1);
});

test("extract survives garbage lines", () => {
  const d = extract("not json\n\n{\"type\":\"user\"}\n" + jsonl);
  assert.equal(d.prompts.length, 2);
});
