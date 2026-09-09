"use strict";
/**
 * Taking the port back from a previous run of this same program.
 *
 * A crash, a killed terminal, or a launcher that never got its will-quit can
 * leave a node process holding the port, so the next start fails with
 * EADDRINUSE. Since that process is ours, the launcher can clear it itself.
 *
 * The one rule: **only ever kill our own program.** A process counts as ours
 * only if it is a node/Electron process whose command line names this
 * project's directory (the game server `server/index.js`, a `npm start` in the
 * project, or the Electron binary living under `launcher/node_modules`), or a
 * node process whose working directory is the project and which was given
 * one of our own entry points by relative name. Anything else on the port is
 * reported and left strictly alone.
 *
 * POSIX only: it reads the port's owner with lsof. Without lsof nothing is
 * found, nothing is killed, and the caller reports the port as busy.
 */

const { execFileSync } = require("child_process");
const path = require("path");

const TERM_WAIT_MS = 2000;   // how long a polite SIGTERM gets to work
const KILL_WAIT_MS = 1000;   // and SIGKILL after it
const POLL_MS = 50;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 });
  } catch (e) {
    return ""; // no lsof, no match, or non-zero exit: nothing to report
  }
}

/** PIDs listening on `port`, this process excluded. */
function listeningPids(port) {
  const out = run("lsof", ["-nP", "-iTCP:" + port, "-sTCP:LISTEN", "-t"]);
  return [...new Set(out.split("\n").map((l) => parseInt(l.trim(), 10)).filter((pid) => pid > 0 && pid !== process.pid))];
}

/** What a process is: its command line and its working directory. */
function describe(pid) {
  const command = run("ps", ["-o", "command=", "-p", String(pid)]).trim();
  const cwdOut = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  const cwdLine = cwdOut.split("\n").find((l) => l.startsWith("n"));
  return { pid, command, cwd: cwdLine ? cwdLine.slice(1) : "" };
}

// Relative names our own entry points are started by from the project root.
const ENTRY_POINTS = new Set([
  "server/index.js", "./server/index.js", "server", "./server", ".", "./",
  "launcher", "./launcher", "launcher/main.js", "./launcher/main.js",
]);

/**
 * Is this process another run of this program? `dir` is the project root.
 * The test is what the process is *running*, never merely where it was
 * started from: an unrelated script run from this folder must not match.
 */
function isOurs(info, dir) {
  if (!info.command) return false;
  const args = info.command.split(/\s+/);
  const exe = path.basename(args[0] || "");
  if (!/^(node|electron|lateral)/i.test(exe)) return false;
  if (args.some((a) => a.includes(dir + path.sep))) return true;
  return info.cwd === dir && args.slice(1).some((a) => ENTRY_POINTS.has(a));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForFree(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (listeningPids(port).length === 0) return true;
    await sleep(POLL_MS);
  }
  return listeningPids(port).length === 0;
}

/**
 * Clear `port` of previous runs of this program.
 * Returns `{killed, skipped, free}`: our processes stopped, foreign processes
 * left alone (with a name), and whether the port ended up free.
 */
async function reclaimPort(port, dir) {
  const killed = [];
  const skipped = [];
  for (const pid of listeningPids(port)) {
    const info = describe(pid);
    if (!isOurs(info, dir)) {
      skipped.push({ pid, name: (info.command.split(/\s+/)[0] || "?").split("/").pop() });
      continue;
    }
    try { process.kill(pid, "SIGTERM"); killed.push(pid); } catch (e) { /* already gone */ }
  }
  if (killed.length === 0) return { killed, skipped, free: listeningPids(port).length === 0 };
  if (!(await waitForFree(port, TERM_WAIT_MS))) {
    for (const pid of killed) { try { process.kill(pid, "SIGKILL"); } catch (e) { /* gone */ } }
    await waitForFree(port, KILL_WAIT_MS);
  }
  return { killed, skipped, free: listeningPids(port).length === 0 };
}

module.exports = { reclaimPort, listeningPids, describe, isOurs, waitForFree };
