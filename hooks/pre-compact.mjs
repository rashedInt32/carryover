#!/usr/bin/env node
// PreCompact hook. Reads the transcript, writes the ledger. Prints nothing:
// PreCompact output cannot shape the summary, so re-injection happens in
// session-start.mjs. Silent exit 0 on every failure path.
import fs from "node:fs";
import { extract, readTranscript } from "../lib/transcript.mjs";
import { renderLedger } from "../lib/ledger.mjs";
import { writeLedger, validSessionId, transcriptRoot, isInside, prune } from "../lib/store.mjs";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function main() {
  if (process.env.CARRYOVER_DISABLE === "1") return;
  let hook;
  try {
    hook = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const sessionId = hook?.session_id;
  const transcriptPath = hook?.transcript_path;
  if (!validSessionId(sessionId) || typeof transcriptPath !== "string") return;

  // The transcript path comes from the harness, but resolve and fence it anyway.
  let real;
  try {
    real = fs.realpathSync.native(transcriptPath);
  } catch {
    return;
  }
  if (!isInside(transcriptRoot(), real)) return;

  const jsonl = readTranscript(real);
  if (jsonl === null) return;

  const data = extract(jsonl);
  const ledger = renderLedger(data, {
    trigger: typeof hook.trigger === "string" ? hook.trigger : "auto",
  });
  writeLedger(sessionId, ledger);
  try {
    prune();
  } catch {
    // best effort
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
