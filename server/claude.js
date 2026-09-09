import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
export const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 90_000);
/** Neutral working directory so the CLI does not pick up a project CLAUDE.md. */
const AGENT_CWD = process.env.CLAUDE_CWD || path.join(__dirname, 'agent-cwd');

/**
 * Run the Claude CLI once in print mode and return the raw result text.
 * The prompt is sent on stdin; the system prompt replaces the CLI default.
 */
export function runClaude({ system, user }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--model', CLAUDE_MODEL,
    '--system-prompt', system,
  ];
  // Strip variables that mark a nested Claude Code session, otherwise the CLI may refuse to start.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: AGENT_CWD, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude timed out after ${CLAUDE_TIMEOUT_MS} ms`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited with code ${code}: ${err.trim() || out.trim()}`));
      let parsed;
      try { parsed = JSON.parse(out); } catch { return reject(new Error(`claude returned non-JSON output: ${out.slice(0, 300)}`)); }
      if (parsed.is_error) return reject(new Error(`claude error: ${parsed.result || parsed.subtype}`));
      resolve({ text: parsed.result ?? '', cost: parsed.total_cost_usd, sessionId: parsed.session_id });
    });
    child.stdin.end(user);
  });
}

const KINDS = ['answer', 'hint', 'verdict', 'solution', 'note'];
const ANSWERS = ['yes', 'no', 'irrelevant', 'cannot_say'];
const VERDICTS = ['correct', 'close', 'incorrect'];

/** Parse the model reply into the structured shape the game relies on. Tolerates code fences and surrounding prose. */
export function parseReply(text) {
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  let obj = null;
  try { obj = JSON.parse(s); } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) { try { obj = JSON.parse(s.slice(start, end + 1)); } catch { /* fallthrough */ } }
  }
  if (!obj || typeof obj !== 'object') return { kind: 'note', answer: null, verdict: null, message: String(text).trim() };
  const kind = KINDS.includes(obj.kind) ? obj.kind : 'note';
  return {
    kind,
    answer: kind === 'answer' && ANSWERS.includes(obj.answer) ? obj.answer : null,
    verdict: kind === 'verdict' && VERDICTS.includes(obj.verdict) ? obj.verdict : null,
    message: typeof obj.message === 'string' && obj.message.trim() ? obj.message.trim() : '(empty reply)',
  };
}
