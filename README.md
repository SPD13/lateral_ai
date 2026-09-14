# LateralAI

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
- [Player profiles](#player-profiles)
- [The question bank](#the-question-bank)
- [The leaderboard](#the-leaderboard)
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
current puzzle: a title, a difficulty badge (double-click it to change the level),  your status on it, how many questions you have asked, and
the situation itself. **Next puzzle** picks another one at random from the puzzles the filters allow.

Below the puzzle is the chat with the game master. Type one yes/no question per message and press Enter:

> *Did the man die of natural causes?*
> *Is the location important?*

The game master replies **Yes**, **No**, **Irrelevant** (the detail does not matter) or **Can't say** (the
story does not decide it, or answering would give too much away). Open questions such as "what happened?"
are not answered; the game master asks you to rephrase, and such messages do not count as questions.

The circular-arrow button in the puzzle card restarts the current puzzle: it discards its conversation,
score and status after a confirmation, so you can play it from scratch. A row of controls above the title decides what you play next: filters for status (New by default), when the
puzzle was added, your rating, the model that wrote it and the difficulty. The end of that row counts the
puzzles that match, or shows **No puzzles** in red when nothing does, and **Next puzzle** then has nowhere
to go. The choice of filters is remembered on this device.

The two **thumbs** on the same row record what you thought of the puzzle. Click one to rate it, click the
same one again to take the rating back. Ratings are per player, survive restarting the puzzle, travel with
an export, and can be filtered in the question bank. A **Game master help** switch next
to the difficulty dropdown (on by default) lets the game master add a short clarification
to an answer, suggest what to ask when a message is not a yes/no question, and point at what is missing in a
close guess. It also makes the judging kinder: a guess that gets the core plot twist right counts as correct
even when a peripheral detail is missing. Switch it off for strict play: bare yes / no / irrelevant /
can't-say answers, verdicts without pointers, and every key fact required before a guess counts as correct. Hints still work when you ask for them. The setting is stored per player on the server
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
for the solution) or **incorrect**. Guesses build on each other: anything you already said in an earlier
guess still counts, so after a "close" you only need to add the missing piece rather than restate the whole
story. Every judged solution counts as a try. Once a puzzle is solved, the
banner shows your score: the number of questions and tries it took, and the number of hints if you used
any. In the chat, replies that count carry a "+1 question" or "+1 try" marker.

Your progress belongs to a player profile, so several people can share one server, and the chat history of
every puzzle is kept: reloading the page or coming back later continues where you left off.

## Player profiles

Every browser starts with one profile, shown as **Player** followed by its name at the right of the header.
The **+** button next to it creates another profile: give it a name and the game switches to it. From then
on the label becomes a dropdown listing every profile, and picking one switches the whole app to it.

The active profile is remembered in this device's local storage, so the same browser comes back to the same
player. Profiles live on the server, so any device can select any of them, and each keeps its own progress,
scores, conversations and Game master help setting. Rename a profile by double-clicking its name on the
leaderboard page.

## The question bank

The **Question bank** page lists every puzzle with its difficulty, your status, your score, the hints you
used, when you last played it, when it was added and which Claude model wrote it. For a solved puzzle the score column leads with the
[leaderboard points](#how-points-are-calculated) it earned, then the questions and tries it took; hovering
the score shows the full calculation.

**Status** is one of:

| Status   | Meaning                                                          |
|----------|------------------------------------------------------------------|
| New      | You have not talked to the game master about it                  |
| Tried    | You started, but have not found the solution yet                 |
| Solved   | You found the solution; the score column shows how many questions and tries it took |
| Revealed | You asked for the solution                                       |

**Double-click a difficulty badge** to change it, in the bank or on the game page. The badge turns into a
dropdown with **Save** and **Cancel**: pick a level and press Save to write it to the bank for every player,
or Cancel (or the Escape key) to leave it alone. Hovering the badge shows the same hint.

Use the search box and the status, rating, model, difficulty and date-added filters to narrow the list. A
puzzle you rated shows its thumb next to the title. Click a column
header to sort by it, and click again to reverse; the default is newest additions first.

Each row has three icon buttons:

- **Play**, **Continue** or **Review** (depending on the status) opens the puzzle in the game page. Continue
  and Review reopen the stored conversation: every question, answer, hint and verdict, including the
  exchange that led to a solution. The Last played column shows how many messages it holds.
- **Reset** clears your status and the stored conversation for that puzzle so you can play it again from scratch.
- **Delete** removes the puzzle from the bank for every player.

Both Reset and Delete ask for confirmation. **Reset all progress** in the toolbar clears every puzzle at
once.

**Export** downloads the active profile's progress as a JSON file: every puzzle's status, score, hint count and full
conversation, plus your Game master help setting. **Import** reads such a file back and replaces your
current progress with it, after a confirmation. Use them to move your progress to another browser or
machine, or to keep a backup before resetting.

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
  "addedAt": "2026-09-09T18:55:08.000Z",
  "model": "fable",
  "sourceUrl": null
}
```

You can edit this file by hand; the server re-reads it whenever it changes, without a restart. The
solution, key facts and hints never leave the server: the browser only ever receives the situation. The
game master sees all of it when answering, which is how it can judge your guesses and pick the next hint.
Progress is stored separately, per player, in `data/progress.json`.

## The leaderboard

The **Leaderboard** page ranks every profile on the server, highest score first. Columns show the points,
the number of puzzles solved, and how many of those were easy, medium and hard. Your own row is
highlighted in green. Above the table, "Playing as" shows the active profile: **double-click the name** to
rename it, with Save and Cancel buttons. The **Export** and **Import** buttons work exactly like the ones
in the question bank and act on the active profile.

Each row has a **delete** button that removes that profile with everything it holds: its progress, its
conversations and its scores. It asks to confirm first and cannot be undone. Deleting the profile you are
playing as switches you to another one. The last remaining profile cannot be deleted, so there is always
someone to play as.

### How points are calculated

Only **solved** puzzles score, and each one counts once. A solved puzzle is worth its difficulty value
minus what it took to get there:

| Item                        | Points |
|-----------------------------|--------|
| Easy puzzle solved          | +3     |
| Medium puzzle solved        | +4     |
| Hard puzzle solved          | +5     |
| Each hint used              | −0.5   |
| Each question answered      | −0.1   |
| Each solution submitted     | −0.2   |

A puzzle never scores below zero, so a long hunt costs you that puzzle's points but never eats into the
rest. Puzzles you revealed or are still working on score nothing, and a puzzle deleted from the bank stops
counting. For example, a hard puzzle solved with 6 questions, 1 hint and 2 tries scores
5 − 0.6 − 0.5 − 0.4 = **3.5** points.

Those six numbers are only the defaults. **Adjust the scoring weights** at the bottom of the leaderboard
opens a form with one field per weight; saving stores them and reloads the page, and every score is
recalculated from the games already played, so nobody has to replay anything. The weights apply to every
player and are kept in `data/scoring.json`; **Restore defaults** fills the form with the values above,
ready to save. The explanation, the example and the per-puzzle tooltips in the question bank all follow
whatever is configured.

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

- **Approve and add to the bank** appends the puzzle to `data/puzzles.json` with a unique id, today's date
  and the model family that wrote it. It is playable straight away.
- **Reject** drops it.

Candidates are kept in `data/candidates.json` until you decide, so reloading the page or restarting the
server does not lose them. One generation runs at a time.

Three to five puzzles per run keeps the results varied and the review manageable. Larger batches tend to
repeat mechanisms, and every run sends the whole bank to the model, so the prompt grows with the bank.

The puzzle writer, the web collector and the game master can each use a different model. Pick them in the
launcher's Setup tab, or set `GENERATOR_MODEL` and `COLLECTOR_MODEL` when starting the server by hand. Each
card on the Generate page names the model it will use. Set `GENERATOR_TOOLS=""` to disable web search.

The same writer is available from a terminal without the review step; it appends straight to the bank,
skipping duplicates:

```bash
node scripts/generate-puzzles.js --count 3 --difficulty hard --model opus
node scripts/generate-puzzles.js --count 3 --difficulty mixed --dry-run   # print without saving
```

### Collecting puzzles from the web

The second card on the Generate page, **Search the web**, collects puzzles that already exist online instead
of writing new ones. Choose how many to take (up to 20, default 10) and press the button: the model looks for
a page of lateral thinking puzzles, checks it against the pages already used, reads it, and brings back that
many of its puzzles rewritten only as far as the game needs. It keeps the source's facts, adds the three hints and the difficulty
that a source rarely provides, and skips anything close to a puzzle already in the game.

Results land in the same **Awaiting review** list as generated puzzles, each showing its source link, and are
checked against the bank again before they appear. Approved ones are stored with the model `web-search`
instead of a model family, and keep their source: the question bank shows it in the model tooltip, and the
play page shows a **Source** link under the situation that opens in a new tab.

Pages that have been visited are recorded in `data/sources.json`, with or without a usable puzzle, and every
later search is told about them so it looks somewhere new. **Pages already used** lists them under the card,
with how many of their puzzles are in the game and a **Take more** button: that goes back to the page for the
puzzles it has not given yet, listing the titles already taken so it skips them and never searches for
another page. A visit that brings back nothing new marks the page **exhausted**: its button is replaced by a
label saying so, and the mark is cleared if a later visit does find something, in case the page has grown. Revisiting is much cheaper than a first visit, since there is no search and the page is the
only thing to read. The briefings live in `server/templates/collect.md` and `collect-more.md`.

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
- `collect-system.md` and `collect.md`: the web collector's briefing. Placeholders: `{{COUNT}}`,
  `{{EXISTING_SOURCES}}`, `{{EXISTING_PUZZLES}}`, `{{LANGUAGE}}`.
- `collect-more.md`: used when going back to a page already visited. Placeholders: `{{COUNT}}`,
  `{{SOURCE_URL}}`, `{{TAKEN_TITLES}}`, `{{EXISTING_PUZZLES}}`, `{{LANGUAGE}}`.

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
| `COLLECTOR_MODEL`      | same as `GENERATOR_MODEL` | Model that searches the web and reads puzzle pages               |
| `GENERATOR_TOOLS`      | `WebSearch,WebFetch` | CLI tools the puzzle writer may use; `""` disables web search        |
| `GENERATOR_TIMEOUT_MS` | `360000`             | Timeout for one generation run (6 minutes)                           |
| `COLLECT_TIMEOUT_MS`   | `1200000`            | Timeout for one web collection run (20 minutes)                      |
| `COLLECT_COUNT`        | `10`                 | Default number of puzzles a web collection run takes from a page     |
| `COLLECT_MAX`          | `20`                 | Ceiling for that number                                              |
| `CLAUDE_BIN`           | `claude`             | Path to the CLI                                                      |
| `CLAUDE_TIMEOUT_MS`    | `90000`              | Timeout for one chat reply                                           |
| `LG_DEBUG`             | unset                | `1` enables the rendered-prompt endpoint                             |
| `PUZZLES_FILE`, `PROGRESS_FILE`, `CANDIDATES_FILE`, `SCORING_FILE`, `SOURCES_FILE`, `TEMPLATE_DIR` | project paths | Override file locations |

## Project layout

```
data/puzzles.json            the puzzle bank
data/progress.json           player profiles and their progress, created at runtime (gitignored)
data/candidates.json         generated puzzles awaiting review, created at runtime (gitignored)
data/scoring.json            scoring weights, written when they are changed (gitignored)
data/sources.json            web pages the collector has used, created at runtime (gitignored)
server/index.js              Express app and API
server/claude.js             runs `claude -p` and parses its JSON reply
server/prompt.js             renders the game master templates
server/generator.js          puzzle writer and web collector: prompts, duplicate check, jobs, review queue
server/sources.js            the web pages the collector has already visited
server/puzzles.js            loads, validates, adds and deletes puzzles
server/store.js              progress persistence
server/templates/            all prompt templates (see Tuning the prompts)
server/agent-cwd/            empty working directory used when invoking the CLI
public/                      front end: index.html (play), bank.html, generate.html, leaderboard.html
launcher/                    Electron launcher
scripts/generate-puzzles.js  terminal puzzle generator
img/                         logo sources
```

## API

| Method | Path                          | Purpose                                                            |
|--------|-------------------------------|--------------------------------------------------------------------|
| GET    | `/api/health`                 | Liveness: app name, pid, port, models, puzzle and candidate counts, uptime |
| GET    | `/api/me`                     | Active profile, models, solved/tried/revealed counts, settings     |
| GET    | `/api/profiles`               | Every player profile and which one is active                       |
| POST   | `/api/profiles`               | Create a profile: `{ name }`                                       |
| PATCH  | `/api/profiles/:id`           | Rename a profile: `{ name }`                                       |
| DELETE | `/api/profiles/:id`           | Delete a profile and its progress (refused for the last one)       |
| GET    | `/api/leaderboard`            | Ranked profiles with points and solved counts, plus the scoring table |
| GET/PUT| `/api/scoring`                | The scoring weights shared by every player                          |
| GET/PUT| `/api/settings`               | Player settings: `{ gmHelp }`                                      |
| GET    | `/api/puzzles`                | All puzzles with this player's status (no solutions)               |
| GET    | `/api/puzzles/random`         | Random puzzle, preferring unsolved; `?exclude=id&difficulty=easy`  |
| GET    | `/api/puzzles/:id`            | Puzzle plus progress and chat history                              |
| POST   | `/api/puzzles/:id/chat`       | `{ intent, text }` → `{ reply, progress }`                         |
| PATCH  | `/api/puzzles/:id`            | Change a puzzle in the bank: `{ difficulty }`                       |
| PUT    | `/api/puzzles/:id/rating`     | Rate a puzzle: `{ rating: "up" | "down" | null }`                   |
| DELETE | `/api/puzzles/:id`            | Remove a puzzle from the bank (for every player)                   |
| GET    | `/api/progress/export`        | Download this player's progress as a JSON file                     |
| POST   | `/api/progress/import`        | Replace this player's progress with an exported file               |
| POST   | `/api/progress/reset`         | `{ puzzleId }` to reset one, `{}` to reset everything              |
| GET    | `/api/generate/config`        | Writer model, tools, running job and recent jobs                   |
| POST   | `/api/generate`               | `{ count, difficulty }` → `202 { job }`; poll the job              |
| POST   | `/api/collect`                | `{ count, sourceUrl? }`: search for a new source, or revisit a used one → `202 { job }` |
| GET    | `/api/sources`                | Web pages the collector has already used                            |
| GET    | `/api/generate/jobs/:id`      | Job status: `running`, `done` (added, dropped, tokens) or `error`  |
| GET    | `/api/candidates`             | Generated puzzles awaiting review (with solutions)                 |
| POST   | `/api/candidates/:id/approve` | Add the candidate to the bank                                      |
| POST   | `/api/candidates/:id/reject`  | Drop the candidate                                                 |

Requests carry the active profile in an `X-Profile-Id` header (plain links use `?profile=`); without one
the server falls back to the profile belonging to the browser's own cookie.

A chat turn: the browser posts the intent and text; the server marks the puzzle *tried*, renders the
game master template with the puzzle, its secret solution, the prepared hints and the conversation so far,
sends it to `claude -p` with tools disabled, and parses one JSON object (`kind`, `answer`, `verdict`,
`message`). A `correct` verdict marks the puzzle solved, a revealed solution marks it revealed, a hint
increments the hint counter, and an answered question increments the score.

## Credits

- Created by [SPD13](https://github.com/SPD13) with the help of Claude Code
