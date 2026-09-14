"use strict";

const $ = (id) => document.getElementById(id);

// ---- tabs ----
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t === tab);
    for (const name of ["server", "setup", "log"]) $("tab-" + name).hidden = tab.dataset.tab !== name;
    if (tab.dataset.tab === "log") $("log").scrollTop = $("log").scrollHeight;
  });
}

// ---- server tab ----
let current = null;

function renderStatus(s) {
  current = s;
  const toggle = $("toggle");
  toggle.disabled = s.starting;
  toggle.textContent = s.starting ? "STARTING…" : s.ours ? "STOP" : s.external ? "RESTART" : "START";
  toggle.classList.toggle("running", s.ours);

  const pill = $("status-pill");
  pill.className = "";
  if (s.starting) { pill.textContent = "STARTING"; pill.classList.add("starting"); }
  else if (s.ours) { pill.textContent = (s.healthy ? "RUNNING" : "NOT RESPONDING") + " · PORT " + s.port; pill.classList.add("running"); }
  else if (s.external) { pill.textContent = "RUNNING OUTSIDE LAUNCHER · PORT " + s.port; pill.classList.add("external"); }
  else pill.textContent = "STOPPED";

  const setUrl = (id, url) => {
    const el = $(id);
    if (s.running && url) { el.textContent = url; el.classList.remove("disabled"); }
    else { el.textContent = url ? url + " (stopped)" : "no network connection"; el.classList.add("disabled"); }
  };
  setUrl("internal-url", s.internalUrl);
  setUrl("external-url", s.externalUrl);

  $("d-process").textContent = s.pid
    ? "pid " + s.pid + (s.external ? " (not started by this launcher)" : "") + (s.uptime != null ? " · up " + fmtUptime(s.uptime) : "")
    : "none";
  $("d-model").textContent = s.serverModel ? "claude " + s.serverModel : "claude " + s.model + " (when started)";
  $("d-generator").textContent = s.serverGeneratorModel ? "claude " + s.serverGeneratorModel : "claude " + s.generatorModel + " (when started)";
  $("d-collector").textContent = s.serverCollectorModel ? "claude " + s.serverCollectorModel : "claude " + s.collectorModel + " (when started)";
  $("d-puzzles").textContent = s.puzzles != null ? s.puzzles + " in the bank" + (s.candidates ? ", " + s.candidates + " awaiting review" : "") : "—";
  $("d-claude").textContent = s.claudeBin || "not found on PATH";
  $("d-claude").classList.toggle("bad", !s.claudeBin);

  $("error").textContent = s.error || s.notice || "";
  $("error").classList.toggle("notice", !s.error && !!s.notice);

  if (!$("port").matches(":focus")) $("port").value = s.port;
  $("model").value = s.model;
  $("generator-model").value = s.generatorModel;
  $("collector-model").value = s.collectorModel;
  $("autostart").checked = !!s.autostart;
}

function fmtUptime(sec) {
  if (sec < 60) return sec + "s";
  if (sec < 3600) return Math.floor(sec / 60) + "m";
  return Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
}

$("toggle").addEventListener("click", async () => {
  $("toggle").disabled = true;
  // "RESTART" (server running outside the launcher): start() reclaims the port from our own program
  renderStatus(current.ours ? await window.launcher.stop() : await window.launcher.start());
  $("toggle").disabled = false;
});

for (const id of ["internal-url", "external-url"]) {
  $(id).addEventListener("click", () => {
    if (current && current.running) {
      const url = id === "internal-url" ? current.internalUrl : current.externalUrl;
      if (url) window.launcher.openUrl(url);
    }
  });
}

// ---- setup tab ----
function setupMessage(s, okText) {
  const msg = $("setup-msg");
  msg.textContent = s.error ? s.error : okText;
  msg.className = s.error ? "err" : "ok";
}

$("save-port").addEventListener("click", async () => {
  const s = await window.launcher.setConfig({ port: $("port").value });
  renderStatus(s);
  setupMessage(s, "saved — port " + s.port + (s.ours ? " (server restarted)" : ""));
});

$("model").addEventListener("change", async () => {
  const s = await window.launcher.setConfig({ model: $("model").value });
  renderStatus(s);
  setupMessage(s, "model " + s.model + (s.ours ? " (server restarted)" : ""));
});

$("generator-model").addEventListener("change", async () => {
  const s = await window.launcher.setConfig({ generatorModel: $("generator-model").value });
  renderStatus(s);
  setupMessage(s, "puzzle writer " + s.generatorModel + (s.ours ? " (server restarted)" : ""));
});

$("collector-model").addEventListener("change", async () => {
  const s = await window.launcher.setConfig({ collectorModel: $("collector-model").value });
  renderStatus(s);
  setupMessage(s, "web collector " + s.collectorModel + (s.ours ? " (server restarted)" : ""));
});

$("autostart").addEventListener("change", async () => {
  const s = await window.launcher.setConfig({ autostart: $("autostart").checked });
  renderStatus(s);
  setupMessage(s, s.autostart ? "server will start with the launcher" : "server starts manually");
});

// ---- log tab ----
function appendLog(line) {
  const el = $("log");
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
  el.textContent += (el.textContent ? "\n" : "") + line;
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ---- boot ----
window.launcher.onStatus(renderStatus);
window.launcher.onLog(appendLog);
window.launcher.getLog().then((lines) => { $("log").textContent = lines.join("\n"); });
window.launcher.getStatus().then(renderStatus);
// keep the uptime and external-process detection fresh
setInterval(() => window.launcher.getStatus().then(renderStatus), 5000);
