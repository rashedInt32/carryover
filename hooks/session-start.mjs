#!/usr/bin/env node
// SessionStart hook, matcher "compact". Re-injects the ledger written by
// pre-compact.mjs for this session as additionalContext.
import { readLedger, validSessionId } from "../lib/store.mjs";
import { injectionText } from "../lib/ledger.mjs";

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
  if (hook?.source !== "compact") return;
  if (!validSessionId(hook.session_id)) return;

  const ledger = readLedger(hook.session_id);
  if (!ledger) return;

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: injectionText(ledger),
      },
    })}\n`,
  );
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
