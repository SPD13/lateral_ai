"use strict";
/**
 * Launcher main process: runs the Lateral game server (../server/index.js) as
 * a child process using Electron's bundled Node, persists the port and model,
 * probes the server's /api/health for status, and reports the internal and
 * external (LAN) URLs to the renderer. Closing the app stops the server.
 */

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { reclaimPort, listeningPids } = require("./port");

const PROJECT_ROOT = path.join(__dirname, "..");
const SERVER_ENTRY = path.join(PROJECT_ROOT, "server", "index.js");
const DEFAULT_PORT = 3000;
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const MODELS = ["sonnet", "opus", "haiku", "fable"];
const ICON = path.join(__dirname, "icon.png");
const START_TIMEOUT_MS = 15000;
const HEALTH_POLL_MS = 3000;
const LOG_LINES = 400;

let win = null;
let child = null;          // our server process, when we started one
let starting = false;
let config = { port: DEFAULT_PORT, model: "sonnet", generatorModel: "sonnet", autostart: false };
let lastError = null;
let notice = null;         // something worth saying that is not a failure
let health = null;         // last /api/health reply, or null when nothing answers
let log = [];
let pollTimer = null;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function configPath() { return path.join(app.getPath("userData"), "launcher-config.json"); }

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const port = parseInt(raw.port, 10);
    if (port >= PORT_MIN && port <= PORT_MAX) config.port = port;
    if (MODELS.includes(raw.model)) config.model = raw.model;
    if (MODELS.includes(raw.generatorModel)) config.generatorModel = raw.generatorModel;
    if (typeof raw.autostart === "boolean") config.autostart = raw.autostart;
  } catch (e) { /* first run: defaults */ }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
  } catch (e) { console.error("could not save config:", e); }
}

// ---------------------------------------------------------------------------
// Environment: an app started from the Dock has a minimal PATH, so the usual
// places the `claude` CLI and node tools live are added for the server.
// ---------------------------------------------------------------------------
function augmentedPath() {
  const home = os.homedir();
  const extra = [
    path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), path.join(home, "bin"),
    "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".npm-global", "bin"), path.join(home, ".volta", "bin"),
  ];
  const nvm = path.join(home, ".nvm", "versions", "node");
  try {
    for (const v of fs.readdirSync(nvm).sort().reverse()) extra.push(path.join(nvm, v, "bin"));
  } catch (e) { /* no nvm */ }
  const seen = new Set();
  return [...(process.env.PATH || "").split(path.delimiter), ...extra]
    .filter((p) => p && !seen.has(p) && seen.add(p)).join(path.delimiter);
}

function findClaude(PATH) {
  for (const dir of PATH.split(path.delimiter)) {
    const p = path.join(dir, "claude");
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) { /* next */ }
  }
  return null;
}

/** First non-internal IPv4 address (the LAN IP another device would use). */
function externalIPv4() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function pushLog(line) {
  for (const l of String(line).split(/\r?\n/)) {
    if (!l.trim()) continue;
    const entry = new Date().toLocaleTimeString() + "  " + l;
    log.push(entry);
    if (log.length > LOG_LINES) log.shift();
    if (win && !win.isDestroyed()) win.webContents.send("log", entry);
  }
}

async function probeHealth() {
  try {
    const res = await fetch("http://127.0.0.1:" + config.port + "/api/health", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const h = await res.json();
    return h && h.app === "lateral-game" ? h : null;
  } catch (e) {
    return null;
  }
}

function status() {
  const ip = externalIPv4();
  const PATH = augmentedPath();
  const ours = !!child;
  const healthy = !!health;
  // "external": something answers as the game server on the port, but it is not the process we started
  const external = healthy && !ours;
  return {
    running: ours || external,
    ours,
    external,
    starting,
    healthy,
    pid: ours ? child.pid : (health ? health.pid : null),
    uptime: health ? health.uptime : null,
    port: config.port,
    model: config.model,
    generatorModel: config.generatorModel,
    autostart: config.autostart,
    serverModel: health ? health.model : null,
    serverGeneratorModel: health ? health.generatorModel : null,
    candidates: health ? health.candidates : null,
    puzzles: health ? health.puzzles : null,
    internalUrl: "http://localhost:" + config.port + "/",
    externalUrl: ip ? "http://" + ip + ":" + config.port + "/" : null,
    claudeBin: findClaude(PATH),
    error: lastError,
    notice,
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("status", status());
}

async function refresh() {
  const before = health ? health.pid : null;
  health = await probeHealth();
  const after = health ? health.pid : null;
  if (before !== after) broadcast();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refresh, HEALTH_POLL_MS);
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startServer() {
  if (child || starting) return;
  starting = true;
  lastError = null;
  notice = null;
  broadcast();
  try {
    // Something already on the port? If it is a previous run of this program
    // (a server started from a terminal, or a launcher that died without
    // cleaning up), stop it and take the port. Anything else is left alone.
    if (listeningPids(config.port).length > 0) {
      const taken = await reclaimPort(config.port, PROJECT_ROOT);
      if (taken.skipped.length > 0) {
        const other = taken.skipped[0];
        lastError = "port " + config.port + " is in use by " + other.name + " (pid " + other.pid + "), which is not this program — left alone";
        return;
      }
      if (!taken.free) {
        lastError = "port " + config.port + " is still busy" + (taken.killed.length ? " after stopping pid " + taken.killed.join(", ") : "");
        return;
      }
      if (taken.killed.length > 0) {
        notice = "port " + config.port + " was held by a previous run of this server (pid " + taken.killed.join(", ") + ") — stopped it and started fresh";
        pushLog("[launcher] stopped previous server pid " + taken.killed.join(", "));
      }
    }

    const PATH = augmentedPath();
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", PATH, PORT: String(config.port), CLAUDE_MODEL: config.model, GENERATOR_MODEL: config.generatorModel };
    // never let the server think it runs inside a Claude Code session
    for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) delete env[k];

    pushLog("[launcher] starting server on port " + config.port + " (game master " + config.model + ", puzzle writer " + config.generatorModel + ")");
    const proc = spawn(process.execPath, [SERVER_ENTRY], { cwd: PROJECT_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    child = proc;
    let stderrTail = "";
    proc.stdout.on("data", (d) => pushLog(d));
    proc.stderr.on("data", (d) => { stderrTail = (stderrTail + d).slice(-2000); pushLog(d); });
    proc.on("exit", (code, signal) => {
      pushLog("[launcher] server exited (" + (signal || "code " + code) + ")");
      if (child === proc) {
        child = null;
        if (code && !lastError) lastError = "server exited with code " + code + (stderrTail.trim() ? ": " + stderrTail.trim().split("\n").pop() : "");
        health = null;
        broadcast();
      }
    });

    // wait until it answers, or gives up
    const until = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < until && child === proc) {
      health = await probeHealth();
      if (health && health.pid === proc.pid) break;
      await sleep(250);
    }
    if (child === proc && !(health && health.pid === proc.pid)) {
      lastError = "server did not answer on port " + config.port + " within " + START_TIMEOUT_MS / 1000 + " s";
      await stopServer();
    } else if (child === proc && !findClaude(PATH)) {
      notice = "server is up, but the `claude` CLI was not found on PATH — chat replies will fail until it is installed";
    }
  } catch (e) {
    lastError = e.message;
    child = null;
  } finally {
    starting = false;
    broadcast();
  }
}

async function stopServer() {
  if (!child) return;
  const proc = child;
  child = null;
  notice = null;
  pushLog("[launcher] stopping server pid " + proc.pid);
  const exited = new Promise((resolve) => proc.once("exit", resolve));
  try { proc.kill("SIGTERM"); } catch (e) { /* already gone */ }
  const timeout = sleep(3000).then(() => "timeout");
  if ((await Promise.race([exited, timeout])) === "timeout") {
    try { proc.kill("SIGKILL"); } catch (e) { /* gone */ }
    await Promise.race([exited, sleep(1000)]);
  }
  health = null;
  broadcast();
}

// ---------------------------------------------------------------------------
// Window and IPC
// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: "Lateral Launcher",
    backgroundColor: "#12131a",
    icon: ICON,   // window icon (Windows, Linux); the Dock icon on macOS is set below
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // dev aid: LAUNCHER_SCREENSHOT=/path/file.png writes a capture of the window a few seconds after launch
  if (process.env.LAUNCHER_SCREENSHOT) {
    setTimeout(async () => {
      try { fs.writeFileSync(process.env.LAUNCHER_SCREENSHOT, (await win.webContents.capturePage()).toPNG()); }
      catch (e) { console.error("screenshot failed:", e.message); }
    }, 8000);
  }
}

app.whenReady().then(async () => {
  loadConfig();

  ipcMain.handle("get-status", async () => { health = await probeHealth(); return status(); });
  ipcMain.handle("start", async () => { await startServer(); return status(); });
  ipcMain.handle("stop", async () => { await stopServer(); return status(); });
  ipcMain.handle("get-log", () => log);
  ipcMain.handle("open-url", (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle("set-config", async (e, patch) => {
    const next = { ...config };
    if (patch.port !== undefined) {
      const port = parseInt(patch.port, 10);
      if (!(port >= PORT_MIN && port <= PORT_MAX)) return { ...status(), error: "port must be between " + PORT_MIN + " and " + PORT_MAX };
      next.port = port;
    }
    if (patch.model !== undefined) {
      if (!MODELS.includes(patch.model)) return { ...status(), error: "unknown model " + patch.model };
      next.model = patch.model;
    }
    if (patch.generatorModel !== undefined) {
      if (!MODELS.includes(patch.generatorModel)) return { ...status(), error: "unknown model " + patch.generatorModel };
      next.generatorModel = patch.generatorModel;
    }
    if (patch.autostart !== undefined) next.autostart = !!patch.autostart;
    const restart = !!child && (next.port !== config.port || next.model !== config.model || next.generatorModel !== config.generatorModel);
    if (restart) await stopServer();
    config = next;
    saveConfig();
    lastError = null;
    if (restart) await startServer();
    else { health = await probeHealth(); broadcast(); }
    return status();
  });

  if (process.platform === "darwin" && app.dock) app.dock.setIcon(ICON);
  createWindow();
  health = await probeHealth();
  startPolling();
  if (config.autostart || process.env.LAUNCHER_AUTOSTART === "1") startServer();

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", async () => {
  await stopServer();
  app.quit();
});

// every quit path (Cmd+Q, Dock, shutdown) stops the server before exiting
app.on("will-quit", (e) => {
  if (child) {
    e.preventDefault();
    stopServer().then(() => app.quit());
  }
});
