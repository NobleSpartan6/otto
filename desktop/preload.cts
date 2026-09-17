import { contextBridge, ipcRenderer } from "electron";
import type { OttoAPI } from "../shared/types.js";

const api: OttoAPI = {
  config: () => ipcRenderer.invoke("otto:config"),
  apps: () => ipcRenderer.invoke("otto:apps"),
  permissions: (kind) => ipcRenderer.invoke("otto:permissions", kind),
  start: (input) => ipcRenderer.invoke("otto:start", input),
  run: (id) => ipcRenderer.invoke("otto:run", id),
  approve: (id, actionId) => ipcRenderer.invoke("otto:approve", id, actionId),
  confirm: (id) => ipcRenderer.invoke("otto:confirm", id),
  stop: (id) => ipcRenderer.invoke("otto:stop", id),
  saveKey: (key, remember) =>
    ipcRenderer.invoke("otto:save-key", key, remember),
  clearKey: () => ipcRenderer.invoke("otto:clear-key"),
  savePlannerKey: (key, remember) =>
    ipcRenderer.invoke("otto:save-planner-key", key, remember),
  clearPlannerKey: () => ipcRenderer.invoke("otto:clear-planner-key"),
  exportRun: (id) => ipcRenderer.invoke("otto:export", id),
  openExternal: (url) => ipcRenderer.invoke("otto:external", url),
};
contextBridge.exposeInMainWorld("otto", Object.freeze(api));
