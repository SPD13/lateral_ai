# Lateral

<img src="img/lateral_thinking_logo.png" alt="Lateral logo" width="96" align="right">

A chat-based lateral thinking puzzle game. The game master describes a strange situation, and you work out
the hidden story by asking questions that can be answered with *yes*, *no* or *irrelevant*. The game master
is Claude, run through the Claude Code CLI on the machine that hosts the server, and it also writes new
puzzles for the bank on request.

The game runs in the browser. A small Node.js server serves the pages, keeps the puzzle bank and your
progress, and talks to Claude. An optional Electron launcher starts and stops that server from a window and
shows the address other devices on your network can use.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
  - [The server](#the-server)
  - [The Electron launcher](#the-electron-launcher)
- [How to play](#how-to-play)
- [The question bank](#the-question-bank)
- [Generating new questions](#generating-new-questions)
- [Configuration reference](#configuration-reference)
- [Project layout](#project-layout)
- [API](#api)

## Requirements

- **Node.js 18 or newer.** Download the latest version from <https://nodejs.org/en/download>. Check with
  `node --version`. The Electron launcher ships its own copy of Node for running the server, but Node and
  npm are still needed to install the dependencies.
- **The Claude Code CLI**, installed and logged in on the machine that runs the server. Install it by
  following <https://docs.anthropic.com/en/docs/claude-code/setup>, then run `claude` once to log in.
  `claude --version` must work in a terminal. The game master and the puzzle writer both run through
  this CLI, so usage is billed to the account it is logged in with.
- **git**, to get the code: <https://git-scm.com/downloads>.

Works on macOS and Linux. On Windows everything runs except the launcher's "take the port back from a
previous run" feature, which relies on `lsof`.

## Installation

Get the code:

```bash
git clone https://github.com/SPD13/lateral_game.git
cd lateral_game
```

### The server

```bash
npm install
npm start
```

The server prints its address, by default <http://localhost:3000>. Open it in a browser to play. Other
devices on the same network can use your machine's IP address with the same port (the launcher shows it;
otherwise look it up with `ifconfig` or `ipconfig`).

Stop it with Ctrl+C. To use another port or model, set environment variables before starting, for example
`PORT=8080 CLAUDE_MODEL=opus npm start`. See [Configuration reference](#configuration-reference).

### The Electron launcher

The launcher is a desktop window with a START/STOP button, the server status, the internal and external
URLs, a log, and settings for the port and the models. It runs the same server as `npm start`.

```bash
cd launcher
npm install
npm start
```

The first `npm install` downloads Electron (about 100 MB). Then:

- **Server tab**: press START. The status pill turns green, and the two URLs become clickable: the
  internal one for this machine and the external one for phones, tablets or other computers on your
  network. The tab also shows the server process, the game master and puzzle writer models, the number
  of puzzles in the bank and where the `claude` CLI was found. If the CLI is missing, a warning appears.
- **Setup tab**: choose the port (default 3000), the game master model, the puzzle writer model, and
  whether the server should start automatically when the launcher opens. Changes are saved and applied
  immediately; a running server restarts.
- **Log tab**: the server output, one line per chat reply with the answer kind, timing and cost, and
  one per generation run.

Closing the window or quitting the app stops the server. If the port is already held by a previous run of
this project (for example a server left running from a terminal), the launcher stops it and starts
fresh, saying which process it cleared. It never touches a process that is not this program: anything
else on the port is named in an error and left alone. More details in [`launcher/README.md`](launcher/README.md).

## How to play

Open the game page. The header shows how many puzzles you have solved, and the card below it shows the
current puzzle: a title, a difficulty badge, your status on it, how many questions you have asked, and
the situation itself. **New puzzle** picks another one at random, preferring puzzles you have not solved;
the dropdown next to it restricts the pick to one difficulty.

Below the puzzle is the chat with the game master. Type one yes/no question per message and press Enter:

> *Did the man die of natural causes?*
> *Is the location important?*

The game master replies **Yes**, **No**, **Irrelevant** (the detail does not matter) or **Can't say** (the
story does not decide it, or answering would give too much away). Open questions such as "what happened?"
are not answered; the game master asks you to rephrase, and such messages do not count as questions.

A **Game master help** switch under the chat (on by default) lets the game master add a short clarification
to an answer, suggest what to ask when a message is not a yes/no question, and point at what is missing in a
close guess. Switch it off for strict play: bare yes / no / irrelevant / can't-say answers and verdicts
without pointers. Hints still work when you ask for them. The setting is stored per player on the server
and is not affected by a progress reset.

A **How to play** panel next to the chat summarises all of this. It is open by default on wide screens and
collapsed on small ones; the "?" button in the puzzle card shows or hides it, and your choice is remembered
in the browser.

The buttons above the input, and the slash shortcuts, change what a message means:

| Button                   | Shortcut        | What happens                                                            |
|--------------------------|-----------------|-------------------------------------------------------------------------|
| Ask a question           | *(default)*     | A yes/no question about the situation                                   |
| Submit a solution        | `/guess …`      | You describe what you think happened; the game master judges it         |
| Get a hint               | `/hint`         | The next prepared hint, from gentle to nearly giving it away            |
| Give up: show solution   | `/solution`     | After a confirmation, the full solution is revealed                     |

When you submit a solution, the answer is **correct** (the puzzle is marked solved and the full story is
told), **close** (the right idea, but one important element is missing or wrong; you can try again or ask
for the solution) or **incorrect**. Every judged solution counts as a try. Once a puzzle is solved, the
banner shows your score: the number of questions and tries it took, and the number of hints if you used
any. In the chat, replies that count carry a "+1 question" or "+1 try" marker.

Your progress is tied to the browser you play in (an anonymous cookie), so another person on another
device has their own progress on the same server. The chat history of every puzzle is kept, so reloading
the page or coming back later continues where you left off.

## The question bank

The **Question bank** page lists every puzzle with its difficulty, your status, your score, the hints you
used, when you last played it and when it was added.

**Status** is one of:

| Status   | Meaning                                                          |
|----------|------------------------------------------------------------------|
| New      | You have not talked to the game master about it                  |
| Tried    | You started, but have not found the solution yet                 |
| Solved   | You found the solution; the score column shows how many questions and tries it took |
| Revealed | You asked for the solution                                       |

Use the search box and the status, difficulty and date-added filters to narrow the list. Click a column
header to sort by it, and click again to reverse; the default is newest additions first.

Each row has three icon buttons:

- **Play**, **Continue** or **Review** (depending on the status) opens the puzzle in the game page. Continue
  and Review reopen the stored conversation: every question, answer, hint and verdict, including the
  exchange that led to a solution. The Last played column shows how many messages it holds.
- **Reset** clears your status and the stored conversation for that puzzle so you can play it again from scratch.
- **Delete** removes the puzzle from the bank for every player.

Both Reset and Delete ask for confirmation. **Reset all progress** in the toolbar clears every puzzle at
once.

Under the hood the bank is the file `data/puzzles.json`, a JSON array. Each puzzle has an id, a title, a
difficulty (`easy`, `medium` or `hard`), the situation the player sees, the secret solution, the key facts
a correct answer must contain, up to three progressive hints, and the date it was added:

```json
{
  "id": "romeo-juliet",
  "title": "Romeo and Juliet",
  "difficulty": "easy",
  "situation": "Romeo and Juliet are found dead on the floor of a room. Around them are broken glass and a puddle of water. There are no marks on their bodies. What happened?",
  "solution": "Romeo and Juliet are goldfish. Their bowl was knocked off a table and shattered, and they died on the floor.",
  "keyFacts": ["Romeo and Juliet are fish (goldfish)", "Their bowl fell and broke"],
  "hints": ["Romeo and Juliet are not human.", "Think about what the water and glass were before they ended up on the floor.", "They lived in the water."],
  "addedAt": "2026-09-09T18:55:08.000Z"
}
```

You can edit this file by hand; the server re-reads it whenever it changes, without a restart. The
solution, key facts and hints never leave the server: the browser only ever receives the situation. The
game master sees all of it when answering, which is how it can judge your guesses and pick the next hint.
Progress is stored separately, per player, in `data/progress.json`.

## Generating new questions

Press **Generate new questions** in the question bank (or open the **Generate** page). Choose how many
puzzles to write (1 to 6, default 3) and a difficulty, or *Mixed* to get a spread, then press
**Generate**.

The puzzle writer is a Claude model, run through the same CLI as the game master. It receives a briefing
built from `server/templates/generate.md` that contains every puzzle already in the bank and every
candidate still waiting for review, with their solutions, and tells the model to write new stories in its
own words and not reuse any of them, even with different names or settings. The writer may use web search
to find inspiration: classic situation puzzles, folklore, true stories with a surprising explanation.
Generation takes from half a minute to a few minutes and the page shows the elapsed time.

When the run finishes, the page reports how many puzzles were written and how many tokens it used. Each
result is checked again by the server before it appears: a puzzle with the same id or title as an
existing one, or whose situation or solution overlaps too much with a bank entry or another candidate,
is dropped and listed with the reason.

The remaining candidates appear under **Awaiting review**, each with its title, difficulty and situation.
The solution, key facts and hints are hidden until you click **Show solution**, so you can first judge the
situation the way a player would. Then:

- **Approve and add to the bank** appends the puzzle to `data/puzzles.json` with a unique id and today's
  date. It is playable straight away.
- **Reject** drops it.

Candidates are kept in `data/candidates.json` until you decide, so reloading the page or restarting the
server does not lose them. One generation runs at a time.

Three to five puzzles per run keeps the results varied and the review manageable. Larger batches tend to
repeat mechanisms, and every run sends the whole bank to the model, so the prompt grows with the bank.

The puzzle writer model can differ from the game master's. Pick it in the launcher's Setup tab, or set
`GENERATOR_MODEL` when starting the server by hand. Set `GENERATOR_TOOLS=""` to disable web search.

The same writer is available from a terminal without the review step; it appends straight to the bank,
skipping duplicates:

```bash
node scripts/generate-puzzles.js --count 3 --difficulty hard --model opus
node scripts/generate-puzzles.js --count 3 --difficulty mixed --dry-run   # print without saving
```

### Tuning the prompts

Every prompt sent to Claude is a markdown template under `server/templates/`, re-read on each request so
edits apply without a restart:

- `system.md` and `context.md`: the game master's briefing for a chat turn, with one file per intent under
  `intents/` (`question.md`, `hint.md`, `guess.md`, `reveal.md`). Placeholders: `{{PUZZLE_TITLE}}`,
  `{{PUZZLE_ID}}`, `{{DIFFICULTY}}`, `{{SITUATION}}`, `{{SOLUTION}}`, `{{KEY_FACTS}}`, `{{HINTS}}`,
  `{{HINTS_GIVEN_COUNT}}`, `{{HISTORY}}`, `{{INTENT}}`, `{{USER_MESSAGE}}`, `{{INTENT_INSTRUCTIONS}}`,
  `{{LANGUAGE}}`, `{{HELP_MODE}}`, `{{HELP_INSTRUCTIONS}}` (from `help/on.md` or `help/off.md`, following the
  player's Game master help switch).
- `generate-system.md` and `generate.md`: the puzzle writer's briefing. Placeholders: `{{COUNT}}`,
  `{{DIFFICULTY}}`, `{{EXISTING_COUNT}}`, `{{EXISTING_PUZZLES}}`, `{{LANGUAGE}}`.

`{{LANGUAGE}}` comes from `GAME_LANGUAGE` (default English) and every template tells the model to use
it regardless of the language the player types in.

Keep each template's output-format section: the server parses the JSON it describes. With `LG_DEBUG=1`
the server exposes `GET /api/puzzles/<id>/prompt?intent=question&text=...` to see a rendered game master
prompt.

## Configuration reference

Environment variables read by the server (all optional). The launcher sets `PORT`, `CLAUDE_MODEL` and
`GENERATOR_MODEL` from its Setup tab.

| Variable               | Default              | Purpose                                                              |
|------------------------|----------------------|----------------------------------------------------------------------|
| `PORT`                 | `3000`               | HTTP port                                                            |
| `CLAUDE_MODEL`         | `sonnet`             | Game master model passed to `claude --model` (sonnet, opus, haiku, fable) |
| `GAME_LANGUAGE`        | `English`            | Language the game master and puzzle writer must use, whatever the player types |
| `GM_HELP_DEFAULT`      | `1`                  | Default of the per-player "Game master help" switch; `0` starts strict          |
| `GENERATOR_MODEL`      | same as `CLAUDE_MODEL` | Puzzle writer model used when generating new questions             |
| `GENERATOR_TOOLS`      | `WebSearch,WebFetch` | CLI tools the puzzle writer may use; `""` disables web search        |
| `GENERATOR_TIMEOUT_MS` | `360000`             | Timeout for one generation run                                       |
| `CLAUDE_BIN`           | `claude`             | Path to the CLI                                                      |
| `CLAUDE_TIMEOUT_MS`    | `90000`              | Timeout for one chat reply                                           |
| `LG_DEBUG`             | unset                | `1` enables the rendered-prompt endpoint                             |
| `PUZZLES_FILE`, `PROGRESS_FILE`, `CANDIDATES_FILE`, `TEMPLATE_DIR` | project paths | Override file locations              |

## Project layout

```
data/puzzles.json            the puzzle bank
data/progress.json           per-player progress, created at runtime (gitignored)
data/candidates.json         generated puzzles awaiting review, created at runtime (gitignored)
server/index.js              Express app and API
server/claude.js             runs `claude -p` and parses its JSON reply
server/prompt.js             renders the game master templates
server/generator.js          puzzle writer: prompt, duplicate check, generation jobs, review queue
server/puzzles.js            loads, validates, adds and deletes puzzles
server/store.js              progress persistence
server/templates/            all prompt templates (see Tuning the prompts)
server/agent-cwd/            empty working directory used when invoking the CLI
public/                      front end: index.html (play), bank.html (question bank), generate.html
launcher/                    Electron launcher
scripts/generate-puzzles.js  terminal puzzle generator
img/                         logo sources
```

## API

| Method | Path                          | Purpose                                                            |
|--------|-------------------------------|--------------------------------------------------------------------|
| GET    | `/api/health`                 | Liveness: app name, pid, port, models, puzzle and candidate counts, uptime |
| GET    | `/api/me`                     | Player id, models, solved/tried/revealed counts, settings          |
| GET/PUT| `/api/settings`               | Player settings: `{ gmHelp }`                                      |
| GET    | `/api/puzzles`                | All puzzles with this player's status (no solutions)               |
| GET    | `/api/puzzles/random`         | Random puzzle, preferring unsolved; `?exclude=id&difficulty=easy`  |
| GET    | `/api/puzzles/:id`            | Puzzle plus progress and chat history                              |
| POST   | `/api/puzzles/:id/chat`       | `{ intent, text }` → `{ reply, progress }`                         |
| DELETE | `/api/puzzles/:id`            | Remove a puzzle from the bank (for every player)                   |
| POST   | `/api/progress/reset`         | `{ puzzleId }` to reset one, `{}` to reset everything              |
| GET    | `/api/generate/config`        | Writer model, tools, running job and recent jobs                   |
| POST   | `/api/generate`               | `{ count, difficulty }` → `202 { job }`; poll the job              |
| GET    | `/api/generate/jobs/:id`      | Job status: `running`, `done` (added, dropped, tokens) or `error`  |
| GET    | `/api/candidates`             | Generated puzzles awaiting review (with solutions)                 |
| POST   | `/api/candidates/:id/approve` | Add the candidate to the bank                                      |
| POST   | `/api/candidates/:id/reject`  | Drop the candidate                                                 |

A chat turn: the browser posts the intent and text; the server marks the puzzle *tried*, renders the
game master template with the puzzle, its secret solution, the prepared hints and the conversation so far,
sends it to `claude -p` with tools disabled, and parses one JSON object (`kind`, `answer`, `verdict`,
`message`). A `correct` verdict marks the puzzle solved, a revealed solution marks it revealed, a hint
increments the hint counter, and an answered question increments the score.

## Credits

- Created by [SPD13](https://github.com/SPD13) with the help of Claude Code
