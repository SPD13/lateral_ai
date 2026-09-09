# Lateral

A chat-based lateral thinking puzzle game. The server picks a situation puzzle from a bank, and the player
works out the hidden story by asking yes/no questions. The game master is Claude, run through the
`claude` CLI on the server, briefed from a customisable markdown template.

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

Or use the desktop launcher (start/stop button, status, internal and LAN URLs, log):

```bash
cd launcher && npm install && npm start
```

See `launcher/README.md`. Requirements: Node 18+, and the [Claude Code CLI](https://docs.anthropic.com/claude-code) installed and logged in
(`claude --version` must work in the shell that starts the server).

Environment variables (all optional):

| Variable            | Default    | Purpose                                                            |
|---------------------|------------|--------------------------------------------------------------------|
| `PORT`              | `3000`     | HTTP port                                                          |
| `CLAUDE_MODEL`      | `sonnet`   | Model passed to `claude --model`                                   |
| `CLAUDE_BIN`        | `claude`   | Path to the CLI                                                    |
| `CLAUDE_TIMEOUT_MS` | `90000`    | Per-message timeout                                                |
| `LG_DEBUG`          | unset      | `1` exposes `GET /api/puzzles/:id/prompt?intent=…&text=…` to inspect the rendered prompt |
| `PUZZLES_FILE`, `PROGRESS_FILE`, `TEMPLATE_DIR` | see below | Override file locations |

## Layout

```
data/puzzles.json          puzzle bank (generated offline, see below)
data/progress.json         per-player progress, created at runtime (gitignored)
server/index.js            Express app and API
server/claude.js           runs `claude -p` and parses its JSON reply
server/prompt.js           renders the context template
server/templates/          system.md, context.md and intents/*.md  <- tune the game master here
server/agent-cwd/          empty working directory used when invoking the CLI
public/                    static front end: index.html (play), bank.html (question bank)
launcher/                  Electron launcher: starts/stops the server, shows status and URLs
scripts/generate-puzzles.js  offline puzzle generator
```

## How a message is handled

1. The browser posts `{ intent, text }` to `POST /api/puzzles/:id/chat`. Intents: `question`, `hint`, `guess`, `reveal`.
   The chat box has a button per intent and also accepts `/hint`, `/guess …` and `/solution`.
2. The server marks the puzzle as **tried** for this player (identified by an anonymous cookie).
3. `server/templates/context.md` is rendered with the puzzle, the secret solution, the key facts, the prepared
   hints, the full conversation so far, the current intent and the matching `intents/<intent>.md` instructions.
4. The rendered prompt is sent on stdin to `claude -p --output-format json --tools ""`, with `system.md` as the
   system prompt. Claude must answer with one JSON object: `{ kind, answer, verdict, message }`.
5. The server updates progress from the parsed reply:
   `verdict: correct` marks the puzzle **solved**, `kind: solution` marks it **revealed**, `kind: hint` bumps the hint counter.
   A `close` verdict is shown with "Try again" / "Show me the solution" buttons.
6. Every message is stored in the player's history so the chat survives a reload, and the bank page shows
   status, hint usage and last-played time. Status can be reset per puzzle or globally (with confirmation).

### Template placeholders

`context.md` may use: `{{PUZZLE_TITLE}}`, `{{PUZZLE_ID}}`, `{{DIFFICULTY}}`, `{{SITUATION}}`, `{{SOLUTION}}`,
`{{KEY_FACTS}}`, `{{HINTS}}`, `{{HINTS_GIVEN_COUNT}}`, `{{HISTORY}}`, `{{INTENT}}`, `{{USER_MESSAGE}}`,
`{{INTENT_INSTRUCTIONS}}`. Templates are re-read on every request, so edits apply without a restart.
Keep the output-format section: the server relies on the JSON shape described there.

## Puzzle bank

Each entry in `data/puzzles.json`:

```json
{
  "id": "romeo-juliet",
  "title": "Romeo and Juliet",
  "difficulty": "easy | medium | hard",
  "situation": "What the player sees.",
  "solution": "The secret story (never sent to the browser).",
  "keyFacts": ["What a correct guess must contain", "..."],
  "hints": ["gentle", "stronger", "almost gives it away"]
}
```

Generate more offline with the CLI (appends to the bank, skipping duplicate ids/titles):

```bash
node scripts/generate-puzzles.js --count 5 --difficulty hard            # or: npm run generate
node scripts/generate-puzzles.js --count 3 --difficulty easy --dry-run  # print without saving
```

The bank file is re-read when it changes, so new puzzles appear without restarting the server.

## API

| Method | Path                          | Purpose                                                   |
|--------|-------------------------------|-----------------------------------------------------------|
| GET    | `/api/health`                 | Liveness: `{ ok, app: "lateral-game", pid, port, model, puzzles, uptime }` |
| GET    | `/api/me`                     | Player id, model, solved/tried/revealed counts             |
| GET    | `/api/puzzles`                | All puzzles with this player's status (no solutions)       |
| GET    | `/api/puzzles/random`         | Random puzzle, preferring unsolved; `?exclude=id&difficulty=easy` |
| GET    | `/api/puzzles/:id`            | Puzzle plus progress and chat history                      |
| POST   | `/api/puzzles/:id/chat`       | `{ intent, text }` → `{ reply, progress }`                 |
| POST   | `/api/progress/reset`         | `{ puzzleId }` to reset one, `{}` to reset everything      |
