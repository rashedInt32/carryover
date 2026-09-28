import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir;
let store;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "carryover-store-"));
  process.env.CARRYOVER_STATE_DIR = dir;
  store = await import("../lib/store.mjs");
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("session ids are validated before touching the filesystem", () => {
  assert.equal(store.validSessionId("41aceeeb-582e-40bb-a9bb-7ad75d80112b"), true);
  assert.equal(store.validSessionId("../x"), false);
  assert.equal(store.validSessionId("a/b"), false);
  assert.equal(store.validSessionId(""), false);
  assert.equal(store.validSessionId(42), false);
  assert.throws(() => store.ledgerPath("../x"), /invalid session id/);
});

test("write then read round-trips, atomically, with owner-only mode", () => {
  const p = store.writeLedger("sess-a", "hello\n");
  assert.equal(path.dirname(p), dir);
  assert.equal(store.readLedger("sess-a"), "hello\n");
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  assert.equal(store.readLedger("sess-missing"), null);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
});

test("prune removes ledgers older than the retention window", () => {
  const old = store.writeLedger("sess-old", "old\n");
  const past = new Date(Date.now() - (store.RETENTION_DAYS + 1) * 86400000);
  fs.utimesSync(old, past, past);
  const removed = store.prune();
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(store.readLedger("sess-a"), "hello\n");
});
