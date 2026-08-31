import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type TemplateId = "12s" | "30s" | "45s" | "60s";
type Aspect = "16:9" | "4:3" | "3:4" | "9:16";
interface PipelineRequest { url: string; template: TemplateId; aspect: Aspect; offline: boolean }
interface DesktopState { process?: ChildProcess; window?: BrowserWindow }

const state: DesktopState = {};
const root = resolve(process.env.GITHUB_VIDEO_STUDIO_ROOT ?? process.cwd());

function isTemplate(value: unknown): value is TemplateId { return value === "12s" || value === "30s" || value === "45s" || value === "60s"; }
function isAspect(value: unknown): value is Aspect { return value === "16:9" || value === "4:3" || value === "3:4" || value === "9:16"; }

function validateRequest(value: unknown): PipelineRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid pipeline request");
  const raw = value as Record<string, unknown>;
  const url = typeof raw.url === "string" ? raw.url : "";
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== "github.com" || parsed.pathname.split("/").filter(Boolean).length < 2) throw new Error("Only public GitHub repository URLs are supported");
  if (!isTemplate(raw.template) || !isAspect(raw.aspect)) throw new Error("Invalid template or aspect");
  return { url, template: raw.template, aspect: raw.aspect, offline: raw.offline === true };
}

function emit(channel: string, payload: unknown): void { state.window?.webContents.send(channel, payload); }

function runPipeline(request: PipelineRequest): Promise<{ code: number }> {
  if (state.process) return Promise.reject(new Error("A pipeline is already running"));
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = ["video", "run", request.url, "--template", request.template, "--aspect", request.aspect];
  if (request.offline) args.push("--offline");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    state.process = child;
    child.stdout.on("data", (chunk: Buffer) => emit("pipeline:output", { stream: "stdout", text: chunk.toString() }));
    child.stderr.on("data", (chunk: Buffer) => emit("pipeline:output", { stream: "stderr", text: chunk.toString() }));
    child.on("error", (error) => { state.process = undefined; reject(error); });
    child.on("close", (code) => { state.process = undefined; emit("pipeline:done", { code: code ?? 1 }); resolvePromise({ code: code ?? 1 }); });
  });
}

async function loadProject(url: string): Promise<Record<string, unknown>> {
  const parsed = new URL(url);
  const name = `${parsed.pathname.split("/").filter(Boolean)[0]}-${parsed.pathname.split("/").filter(Boolean)[1]}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const project = join(root, "projects", name);
  const result: Record<string, unknown> = { projectName: name };
  for (const file of ["github.json", "evidence.json", "script.json", "director-plan.json", "storyboard.json"]) {
    const path = join(project, file);
    if (existsSync(path)) result[file.replace(".json", "")] = JSON.parse(await readFile(path, "utf8")) as unknown;
  }
  return result;
}

function createWindow(): void {
  const window = new BrowserWindow({ width: 1480, height: 960, minWidth: 1180, minHeight: 760, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: join(root, "dist", "apps", "desktop", "preload", "index.js") } });
  state.window = window;
  const index = join(root, "apps", "desktop", "dist", "index.html");
  void window.loadFile(index);
}

ipcMain.handle("pipeline:run", (_event, request: unknown) => runPipeline(validateRequest(request)));
ipcMain.handle("project:load", (_event, url: unknown) => { if (typeof url !== "string") return Promise.reject(new Error("Invalid URL")); return loadProject(url); });
ipcMain.handle("pipeline:cancel", () => { state.process?.kill(); return true; });

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
