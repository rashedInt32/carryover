// Render the extracted state as the markdown ledger the model will read.
import { redact } from "./redact.mjs";
import { clip, LIMITS } from "./transcript.mjs";

export const MAX_LEDGER_CHARS = Number(process.env.CARRYOVER_MAX_CHARS || 12000);

const STATUS_MARK = { completed: "[x]", in_progress: "[~]", pending: "[ ]" };

function section(title, lines) {
  if (lines.length === 0) return "";
  return [`## ${title}`, ...lines, ""].join("\n");
}

/**
 * @param {ReturnType<import("./transcript.mjs").extract>} data
 * @param {{ when?: string, trigger?: string }} meta
 */
export function renderLedger(data, meta = {}) {
  const when = meta.when || new Date().toISOString();
  const head = [
    `# Carryover ledger`,
    `Written before compaction (${meta.trigger || "auto"}) at ${when}.`,
    data.title ? `Session: ${redact(clip(data.title, 120))}` : "",
    data.cwd ? `Working directory: ${data.cwd}` : "",
    data.branch && data.branch !== "HEAD" ? `Branch: ${data.branch}` : "",
    data.compactions > 0 ? `Earlier compactions in this session: ${data.compactions}` : "",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  // Prompts: always keep the first (the goal), then the most recent ones.
  const prompts = data.prompts;
  let chosen = prompts;
  if (prompts.length > LIMITS.maxPrompts) {
    chosen = [prompts[0], ...prompts.slice(-(LIMITS.maxPrompts - 1))];
  }
  const promptLines = chosen.map((p, i) => {
    const n = prompts.length > LIMITS.maxPrompts && i > 0 ? prompts.length - chosen.length + i + 1 : i + 1;
    return `${n}. "${redact(clip(p.text, LIMITS.promptChars))}"`;
  });
  if (prompts.length > LIMITS.maxPrompts) {
    promptLines.splice(1, 0, `… ${prompts.length - chosen.length} earlier message(s) omitted …`);
  }

  const todoLines = data.todos.map(
    (t) => `- ${STATUS_MARK[t.status] || "[ ]"} ${redact(clip(t.content, 200))}`,
  );
  const fileLines = data.files
    .slice(0, LIMITS.maxFiles)
    .map((f) => `- ${f.path}${f.count > 1 ? ` (${f.count} edits)` : ""}`);
  if (data.files.length > LIMITS.maxFiles) fileLines.push(`- … ${data.files.length - LIMITS.maxFiles} more`);
  const commandLines = data.commands.map((c) => `- \`${redact(c).replace(/`/g, "'")}\``);
  const lastLines = data.lastAssistant
    ? [redact(clip(data.lastAssistant, LIMITS.lastAssistantChars))]
    : [];

  const sections = [
    section("The user's instructions, verbatim (first one is the original goal)", promptLines),
    section("Task list at compaction time (latest TodoWrite)", todoLines),
    section("Files edited (most recent first)", fileLines),
    section("Recent commands run", commandLines),
    section("Last assistant message before compaction", lastLines),
  ];

  // Trim from the bottom until the ledger fits. Instructions and todos go last.
  const join = () => sections.filter((s) => s !== "").join("\n");
  let body = join();
  const dropOrder = [4, 3, 2];
  for (const idx of dropOrder) {
    if ((head + body).length <= MAX_LEDGER_CHARS) break;
    sections[idx] = "";
    body = join();
  }
  let text = `${head}\n${body}`.trimEnd();
  if (text.length > MAX_LEDGER_CHARS) text = `${text.slice(0, MAX_LEDGER_CHARS - 1)}…`;
  return `${text}\n`;
}

/** The framing the model sees around the ledger after compaction. */
export function injectionText(ledger) {
  return [
    "Context was just compacted. Below is a ledger extracted mechanically from the transcript",
    "right before compaction: the user's exact words, the task list, files edited, and commands run.",
    "It is not a summary. Where the compaction summary and this ledger disagree, trust the ledger,",
    "and keep following the user's verbatim instructions.",
    "",
    ledger.trimEnd(),
  ].join("\n");
}
