// Ledger storage: one file per session in an owner-only state directory,
// written atomically, pruned by age.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{3,127}$/;
export const RETENTION_DAYS = Number(process.env.CARRYOVER_RETENTION_DAYS || 14);

export function stateDir() {
  const dir =
    process.env.CARRYOVER_STATE_DIR || path.join(os.homedir(), ".local", "state", "carryover");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function validSessionId(id) {
  return typeof id === "string" && SESSION_ID.test(id);
}

export function ledgerPath(sessionId) {
  if (!validSessionId(sessionId)) throw new Error("invalid session id");
  return path.join(stateDir(), `${sessionId}.md`);
}

export function writeLedger(sessionId, text) {
  const target = ledgerPath(sessionId);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, target);
  return target;
}

export function readLedger(sessionId) {
  try {
    return fs.readFileSync(ledgerPath(sessionId), "utf8");
  } catch {
    return null;
  }
}

/** Delete ledgers older than the retention window. Best effort. */
export function prune(now = Date.now()) {
  const dir = stateDir();
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md") && !name.endsWith(".tmp")) continue;
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.unlinkSync(p);
        removed += 1;
      }
    } catch {
      // race with another hook; ignore
    }
  }
  return removed;
}

/** The directory transcripts are allowed to come from. */
export function transcriptRoot() {
  const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  try {
    return fs.realpathSync.native(cfg);
  } catch {
    return cfg;
  }
}

export function isInside(root, child) {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
