// Deterministic extraction from a Claude Code transcript (JSONL).
// No model is involved: the ledger holds exactly what the transcript holds.
import fs from "node:fs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// "sdk" covers headless `claude -p` and Agent SDK prompts, which are human-authored too.
const TYPED_SOURCES = new Set(["typed", "queued", "suggestion_accepted", "sdk"]);

export const LIMITS = {
  promptChars: 700,
  maxPrompts: 12,
  commandChars: 220,
  maxCommands: 15,
  maxFiles: 25,
  lastAssistantChars: 900,
  maxTranscriptBytes: 200 * 1024 * 1024,
};

function clip(s, n) {
  if (typeof s !== "string") return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** A user record that a human actually typed, not a tool result or an injected block. */
function isTypedPrompt(rec) {
  if (rec.type !== "user" || rec.isMeta || rec.isSidechain || rec.isCompactSummary) return false;
  if (!TYPED_SOURCES.has(rec.promptSource)) return false;
  const text = textOf(rec.message?.content).trim();
  if (!text || text.startsWith("<")) return false;
  return true;
}

/**
 * @param {string} jsonl transcript contents
 * @returns {{
 *   title: string, cwd: string, branch: string,
 *   prompts: Array<{text:string, ts:string}>,
 *   files: Array<{path:string, count:number}>,
 *   commands: string[],
 *   todos: Array<{content:string, status:string}>,
 *   lastAssistant: string,
 *   compactions: number,
 * }}
 */
export function extract(jsonl) {
  const out = {
    title: "",
    cwd: "",
    branch: "",
    prompts: [],
    files: [],
    commands: [],
    todos: [],
    lastAssistant: "",
    compactions: 0,
  };
  const fileCounts = new Map();
  const commands = [];
  let lastTodos = null;

  for (const line of jsonl.split("\n")) {
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type === "ai-title" && typeof rec.aiTitle === "string") out.title = rec.aiTitle;
    if (typeof rec.cwd === "string") out.cwd = rec.cwd;
    if (typeof rec.gitBranch === "string") out.branch = rec.gitBranch;
    if (rec.type === "system" && rec.subtype === "compact_boundary") out.compactions += 1;

    if (isTypedPrompt(rec)) {
      out.prompts.push({ text: textOf(rec.message.content), ts: rec.timestamp || "" });
      continue;
    }

    if (rec.type === "assistant" && !rec.isSidechain) {
      const content = rec.message?.content;
      const text = textOf(content).trim();
      if (text) out.lastAssistant = text;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || block.type !== "tool_use") continue;
        const input = block.input || {};
        if (EDIT_TOOLS.has(block.name)) {
          const p = input.file_path || input.notebook_path;
          if (typeof p === "string") {
            // Delete then set: Map keeps insertion order, so the latest edit sits last.
            const n = (fileCounts.get(p) || 0) + 1;
            fileCounts.delete(p);
            fileCounts.set(p, n);
          }
        } else if (block.name === "Bash" && typeof input.command === "string") {
          commands.push(input.command);
        } else if (block.name === "TodoWrite" && Array.isArray(input.todos)) {
          lastTodos = input.todos;
        }
      }
    }
  }

  // Files: most recent first.
  out.files = [...fileCounts.entries()].reverse().map(([p, count]) => ({ path: p, count }));

  // Commands: last N distinct, in order.
  const seen = new Set();
  const distinct = [];
  for (let i = commands.length - 1; i >= 0 && distinct.length < LIMITS.maxCommands; i--) {
    const c = clip(commands[i], LIMITS.commandChars);
    if (seen.has(c)) continue;
    seen.add(c);
    distinct.unshift(c);
  }
  out.commands = distinct;

  if (lastTodos) {
    out.todos = lastTodos
      .filter((t) => t && typeof t.content === "string")
      .map((t) => ({ content: t.content, status: String(t.status || "pending") }));
  }
  return out;
}

/** Read a transcript with a hard size cap. Returns null when too large or unreadable. */
export function readTranscript(realPath) {
  let st;
  try {
    st = fs.statSync(realPath);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > LIMITS.maxTranscriptBytes) return null;
  try {
    return fs.readFileSync(realPath, "utf8");
  } catch {
    return null;
  }
}

export { clip, textOf };
