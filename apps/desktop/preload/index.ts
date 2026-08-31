import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("videoStudio", {
  runPipeline: (request: { url: string; template: "12s" | "30s" | "45s" | "60s"; aspect: "16:9" | "4:3" | "3:4" | "9:16"; offline: boolean }) => ipcRenderer.invoke("pipeline:run", request),
  loadProject: (url: string) => ipcRenderer.invoke("project:load", url),
  cancel: () => ipcRenderer.invoke("pipeline:cancel"),
  onOutput: (listener: (payload: { stream: "stdout" | "stderr"; text: string }) => void) => { const handler = (_event: Electron.IpcRendererEvent, payload: { stream: "stdout" | "stderr"; text: string }) => listener(payload); ipcRenderer.on("pipeline:output", handler); return () => ipcRenderer.removeListener("pipeline:output", handler); },
  onDone: (listener: (payload: { code: number }) => void) => { const handler = (_event: Electron.IpcRendererEvent, payload: { code: number }) => listener(payload); ipcRenderer.on("pipeline:done", handler); return () => ipcRenderer.removeListener("pipeline:done", handler); },
});
