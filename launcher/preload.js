"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getStatus: () => ipcRenderer.invoke("get-status"),
  start: () => ipcRenderer.invoke("start"),
  stop: () => ipcRenderer.invoke("stop"),
  setConfig: (patch) => ipcRenderer.invoke("set-config", patch),
  openUrl: (url) => ipcRenderer.invoke("open-url", url),
  getLog: () => ipcRenderer.invoke("get-log"),
  onStatus: (cb) => ipcRenderer.on("status", (e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on("log", (e, line) => cb(line)),
});
