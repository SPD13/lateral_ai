# LateralAI Launcher

Small Electron app that starts and stops the LateralAI game server and shows how to reach it.

```sh
cd launcher
npm install
npm start
```

- **Server tab** — START/STOP the server and see its status, refreshed every few seconds from the
  server's `/api/health`. When running it shows the internal URL (`http://localhost:<port>/`) and
  the external URL (this machine's LAN IPv4), the address another device on the same network uses.
  Click a URL to open it in the browser. The tab also shows the server pid and uptime, the game
  master model, the number of puzzles in the bank, and whether the `claude` CLI was found.
- **Setup tab** — port (1024–65535, default 3000), the game master model and the puzzle writer
  model (each one of sonnet / opus / haiku / fable; the writer generates new questions from the
  question bank) and
  whether to start the server when the launcher opens. Persisted in the app's user-data folder.
  Changes apply immediately; a running server restarts.
- **Log tab** — the server's stdout/stderr (one line per chat reply with kind, timing and cost).

## How it runs the server

The launcher spawns `../server/index.js` as a child process using Electron's bundled Node
(`ELECTRON_RUN_AS_NODE`), so no separate Node install is needed. It passes `PORT`,
`CLAUDE_MODEL` and `GENERATOR_MODEL`, and extends `PATH` with the usual CLI locations (`~/.local/bin`, Homebrew, nvm…)
because an app opened from the Dock gets a minimal environment and would otherwise not find `claude`.

Closing the window, Cmd+Q, or a system shutdown stops the server before the app exits.

## The port is already in use

If the server is already running when you press START (started from a terminal with `npm start`,
or left behind by a launcher that died), the launcher stops it and starts fresh, and says which pid
it cleared. **Only this program is ever killed**: `port.js` decides by what a process is *running*
(a node/Electron process whose command line names this project directory, or one started from the
project root with one of its entry points), never merely by where it was started. Anything else on
the port is named in an error and left strictly alone.

A server running outside the launcher shows as "RUNNING OUTSIDE LAUNCHER" with its pid; the button
then reads RESTART and does the same reclaim-and-start.

Set `LAUNCHER_AUTOSTART=1` in the environment to start the server on launch regardless of the
saved setting (handy for scripts).
