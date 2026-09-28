// Strip secret-looking values before anything is written to disk or re-injected.
// Commands and prompts in a transcript can carry tokens; the ledger must not.

const PATTERNS = [
  // Known token prefixes: OpenAI/Anthropic style keys, GitHub, Slack, AWS, Google.
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Bearer headers.
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  // PEM blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // key=value or key: value where key names a credential.
  /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth)[A-Za-z0-9_-]*\s*[=:]\s*["']?)(?!Bearer\b|\[redacted\])[^\s"'&;]{6,}/gi,
];

export function redact(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m, keep) => (typeof keep === "string" ? `${keep}[redacted]` : "[redacted]"));
  }
  return out;
}
