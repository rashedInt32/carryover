// End to end: run both hook scripts exactly as Claude Code would.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const preCompact = path.join(here, "..", "hooks", "pre-compact.mjs");
const sessionStart = path.join(here, "..", "hooks", "session-start.mjs");
const fixture = path.join(here, "fixture", "session.jsonl");

let configDir;
let stateDir;
let transcript;
const env = () => ({
  ...process.env,
  CLAUDE_CONFIG_DIR: configDir,
  CARRYOVER_STATE_DIR: stateDir,
});

before(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "carryover-cfg-"));
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "carryover-state-"));
  fs.mkdirSync(path.join(configDir, "projects", "-work-app"), { recursive: true });
  transcript = path.join(configDir, "projects", "-work-app", "sess-1.jsonl");
  fs.copyFileSync(fixture, transcript);
});

after(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function run(script, payload, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...env(), ...extraEnv } });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test("pre-compact writes an owner-only ledger for the session and prints nothing", async () => {
  const r = await run(preCompact, {
    hook_event_name: "PreCompact",
    session_id: "sess-1",
    transcript_path: transcript,
    trigger: "manual",
    cwd: "/work/app",
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
  const ledgerPath = path.join(stateDir, "sess-1.md");
  const text = fs.readFileSync(ledgerPath, "utf8");
  assert.match(text, /Fix the redirect loop on \/login/);
  assert.match(text, /\[redacted\]/);
  assert.doesNotMatch(text, /ghp_/);
  assert.equal(fs.statSync(ledgerPath).mode & 0o777, 0o600);
});

test("session-start re-injects the ledger only for source compact", async () => {
  const good = await run(sessionStart, { hook_event_name: "SessionStart", source: "compact", session_id: "sess-1" });
  assert.equal(good.code, 0, good.err);
  const json = JSON.parse(good.out);
  assert.equal(json.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(json.hookSpecificOutput.additionalContext, /^Context was just compacted\./);
  assert.match(json.hookSpecificOutput.additionalContext, /Guard against expired cookie loop/);

  const startup = await run(sessionStart, { source: "startup", session_id: "sess-1" });
  assert.equal(startup.out, "");
  const unknown = await run(sessionStart, { source: "compact", session_id: "no-such-session" });
  assert.equal(unknown.out, "");
  const off = await run(sessionStart, { source: "compact", session_id: "sess-1" }, { CARRYOVER_DISABLE: "1" });
  assert.equal(off.out, "");
});

test("pre-compact refuses transcripts outside the config dir and bad session ids", async () => {
  const outside = path.join(os.tmpdir(), `carryover-outside-${process.pid}.jsonl`);
  fs.copyFileSync(fixture, outside);
  const r1 = await run(preCompact, { session_id: "sess-outside", transcript_path: outside });
  fs.unlinkSync(outside);
  assert.equal(r1.code, 0);
  assert.equal(fs.existsSync(path.join(stateDir, "sess-outside.md")), false);

  const r2 = await run(preCompact, { session_id: "../evil", transcript_path: transcript });
  assert.equal(r2.code, 0);
  assert.equal(fs.existsSync(path.join(stateDir, "..", "evil.md")), false);
  assert.deepEqual(
    fs.readdirSync(stateDir).filter((f) => f !== "sess-1.md"),
    [],
  );

  const r3 = await run(preCompact, "not json at all");
  assert.equal(r3.code, 0);
});
