import { Command } from "commander";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { analyzeRepository } from "../../../packages/github-analyzer/src/index.js";
import { compactScript, generateScript } from "../../../packages/script-engine/src/index.js";
import { buildStoryboard } from "../../../packages/storyboard/src/index.js";
import { buildAudioTimeline, assertVoiceExists, checkTtsBridge } from "../../../packages/tts-engine/src/index.js";
import { captureStoryboard } from "../../../packages/browser-capture/src/index.js";
import { convertToMp4, inspectVideoFilter, probeMedia, stripAudio } from "../../../packages/ffmpeg-utils/src/index.js";
import { renderProject, renderCovers } from "../../../packages/renderer/src/render.js";
import { poseTravelPx, sampleCameraTrack, targetInsideSafeArea } from "../../../packages/camera-engine/src/index.js";
import { wrapCaption } from "../../../packages/subtitle-engine/src/index.js";
import type { AudioTimeline, CaptureManifest, GitHubAnalysis, ScriptDocument, StoryboardDocument } from "../../../packages/shared/src/types.js";

const root = resolve(process.cwd());
const projectsRoot = join(root, "projects");
const CAPTURE_PIPELINE_VERSION = "capture-v4-github-star-role";
const RENDER_PIPELINE_VERSION = "render-v9-focus-point-qa-content-space-camera-cfr-tail-clean-covers-qa";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "demo";
}

function projectPath(name: string): string {
  return join(projectsRoot, slug(name));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(path, { force: true });
  await (await import("node:fs/promises")).rename(temp, path);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function ensureProject(name: string): Promise<string> {
  const path = projectPath(name);
  await mkdir(path, { recursive: true });
  return path;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function markStage(projectDir: string, stage: string, input: unknown): Promise<void> {
  let previous: { stages?: Record<string, { inputHash: string; updatedAt: string }> } = {};
  try { previous = await readJson<typeof previous>(join(projectDir, "state.json")); } catch { /* first stage */ }
  const stages = previous.stages ?? {};
  stages[stage] = { inputHash: fingerprint(input), updatedAt: new Date().toISOString() };
  await writeJson(join(projectDir, "state.json"), { stage, inputHash: fingerprint(input), updatedAt: new Date().toISOString(), stages });
  await rm(join(projectDir, `${stage}-error.json`), { force: true });
}

async function stageIsCurrent(projectDir: string, stage: string, input: unknown, files: string[]): Promise<boolean> {
  try {
    const state = await readJson<{ stages?: Record<string, { inputHash: string }> }>(join(projectDir, "state.json"));
    return state.stages?.[stage]?.inputHash === fingerprint(input) && files.every((file) => existsSync(isAbsolute(file) ? file : join(projectDir, file)));
  } catch {
    return false;
  }
}

async function getOrAnalyze(url: string, projectName?: string): Promise<{ projectDir: string; analysis: GitHubAnalysis }> {
  const analysis = await analyzeRepository(url);
  const dir = await ensureProject(projectName ?? analysis.name);
  await writeJson(join(dir, "github.json"), analysis);
  await markStage(dir, "analyze", { url: analysis.githubUrl, analyzedAt: analysis.analyzedAt });
  console.log(`Analyzed ${analysis.fullName}: ${analysis.stars} stars, ${analysis.sections.length} README sections`);
  return { projectDir: dir, analysis };
}

async function startBridge(): Promise<{ stop: () => void }> {
  const baseUrl = process.env.INDEXTTS_BRIDGE_URL ?? "http://127.0.0.1:8125";
  if (await checkTtsBridge(baseUrl)) return { stop: () => undefined };
  const python = process.env.INDEXTTS_PYTHON ?? "D:\\AI\\indextts\\.venv\\Scripts\\python.exe";
  const server = resolve(root, "services/indextts-bridge/server.py");
  if (!existsSync(python)) throw new Error(`IndexTTS Python not found: ${python}`);
  const child = spawn(python, [server], { cwd: process.env.INDEXTTS_ROOT ?? "D:\\AI\\indextts", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => process.stdout.write(`[indextts] ${chunk.toString()}`));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[indextts] ${chunk.toString()}`));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await checkTtsBridge(baseUrl)) return { stop: () => child.kill() };
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  child.kill();
  throw new Error("IndexTTS Bridge did not become healthy within 30 seconds");
}

async function runAnalyze(url: string, options: { project?: string }): Promise<void> {
  await getOrAnalyze(url, options.project);
}

async function runScript(name: string): Promise<void> {
  const dir = projectPath(name);
  const analysis = await readJson<GitHubAnalysis>(join(dir, "github.json"));
  const script = await generateScript(analysis);
  await writeJson(join(dir, "script.json"), script);
  await markStage(dir, "script", script);
  console.log(`Script written: ${join(dir, "script.json")}`);
}

async function runStoryboard(name: string): Promise<void> {
  const dir = projectPath(name);
  const analysis = await readJson<GitHubAnalysis>(join(dir, "github.json"));
  const script = await readJson<ScriptDocument>(join(dir, "script.json"));
  const storyboard = buildStoryboard(analysis, script);
  await writeJson(join(dir, "storyboard.json"), storyboard);
  await markStage(dir, "storyboard", storyboard);
  console.log(`Storyboard written with ${storyboard.scenes.length} scenes`);
}

async function runTts(name: string): Promise<void> {
  const dir = projectPath(name);
  let script = await readJson<ScriptDocument>(join(dir, "script.json"));
  const voicePath = process.env.INDEXTTS_VOICE ?? "D:\\AI\\indextts\\voice_8yue19.wav";
  await assertVoiceExists(voicePath);
  const bridge = await startBridge();
  try {
    let timeline = await buildAudioTimeline(script, { baseUrl: process.env.INDEXTTS_BRIDGE_URL ?? "http://127.0.0.1:8125", voicePath, lang: "zh", cacheDir: join(dir, "audio", "cache") }, join(dir, "audio"));
    if (timeline.totalDurationMs > script.targetDurationMs) {
      const analysis = await readJson<GitHubAnalysis>(join(dir, "github.json"));
      const compact = compactScript(analysis);
      if (JSON.stringify(compact.lines.map((line) => line.text)) !== JSON.stringify(script.lines.map((line) => line.text))) {
        script = compact;
        await writeJson(join(dir, "script.json"), script);
        const storyboard = buildStoryboard(analysis, script);
        await writeJson(join(dir, "storyboard.json"), storyboard);
        await markStage(dir, "storyboard", storyboard);
        timeline = await buildAudioTimeline(script, { baseUrl: process.env.INDEXTTS_BRIDGE_URL ?? "http://127.0.0.1:8125", voicePath, lang: "zh", cacheDir: join(dir, "audio", "cache") }, join(dir, "audio"));
      }
    }
    if (timeline.totalDurationMs > script.targetDurationMs) {
      throw new Error(`IndexTTS audio is ${timeline.totalDurationMs}ms, over the ${script.targetDurationMs}ms MVP limit after compacting the script`);
    }
    await writeJson(join(dir, "timeline-audio.json"), timeline);
    await markStage(dir, "tts", timeline);
    console.log(`TTS written: ${timeline.totalDurationMs}ms`);
  } finally {
    bridge.stop();
  }
}

async function runCapture(name: string): Promise<void> {
  const dir = projectPath(name);
  const storyboard = await readJson<StoryboardDocument>(join(dir, "storyboard.json"));
  const timeline = await readJson<AudioTimeline>(join(dir, "timeline-audio.json"));
  const input = { version: CAPTURE_PIPELINE_VERSION, storyboard, timeline };
  if (await stageIsCurrent(dir, "capture", input, ["capture/capture-manifest.json", "capture/capture.webm"])) {
    console.log(`Capture cache hit: ${join(dir, "capture/capture-manifest.json")}`);
    return;
  }
  const manifest = await captureStoryboard(storyboard, timeline, join(dir, "capture"));
  await markStage(dir, "capture", input);
  console.log(`Capture written: ${manifest.videoPath}`);
}

async function runRender(name: string): Promise<void> {
  const dir = projectPath(name);
  const storyboard = await readJson<StoryboardDocument>(join(dir, "storyboard.json"));
  const timeline = await readJson<AudioTimeline>(join(dir, "timeline-audio.json"));
  const manifest = await readJson<CaptureManifest>(join(dir, "capture/capture-manifest.json"));
  const input = { version: RENDER_PIPELINE_VERSION, storyboard, timeline, manifest };
  const outputDir = join(root, "output", slug(name));
  await mkdir(outputDir, { recursive: true });
  if (await stageIsCurrent(dir, "render", input, [join(outputDir, "final.mp4"), join(outputDir, "clean.mp4"), join(outputDir, "quality.json"), join(outputDir, "cover-4x3.png"), join(outputDir, "cover-3x4.png")])) {
    console.log(`Render cache hit: ${join(outputDir, "final.mp4")}`);
    return;
  }
  const captureMp4 = join(outputDir, "capture.mp4");
  await convertToMp4(manifest.videoPath, captureMp4);
  const finalPath = join(outputDir, "final.mp4");
  const finalRender = await renderProject({ captureVideo: captureMp4, captureStartMs: manifest.videoStartMs, narrationAudio: timeline.audioPath, audioTimeline: timeline, captureEvents: manifest.events, storyboard, outputPath: finalPath });
  const cleanPath = join(outputDir, "clean.mp4");
  await renderProject({ captureVideo: captureMp4, captureStartMs: manifest.videoStartMs, narrationAudio: timeline.audioPath, audioTimeline: timeline, captureEvents: manifest.events, storyboard, outputPath: cleanPath, includeAudio: false, includeVisuals: false, includeSubtitles: false });
  const cleanNoAudioPath = join(outputDir, "clean.noaudio.mp4");
  await stripAudio(cleanPath, cleanNoAudioPath);
  await rm(cleanPath, { force: true });
  await (await import("node:fs/promises")).rename(cleanNoAudioPath, cleanPath);
  await copyFile(timeline.audioPath, join(outputDir, "narration.wav"));
  await copyFile(finalPath, join(outputDir, "test.mp4"));
  const covers = await renderCovers(storyboard, outputDir);
  const probe = await probeMedia(finalPath);
  const track = finalRender.cameraTrack;
  const structuralChecks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }> = [];
  const maxScale = Math.max(...track.frames.map((frame) => frame.pose.scale), 0);
  structuralChecks.push({ name: "camera-scale-cap", status: maxScale <= 2.8 ? "pass" : "fail", message: `max scale ${maxScale.toFixed(2)}` });
  const cameraBoundsOk = track.frames.every((frame) => frame.pose.scale <= 2.8 && frame.pose.cx >= 0 && frame.pose.cx <= 1 && frame.pose.cy >= 0 && frame.pose.cy <= 1);
  structuralChecks.push({ name: "camera-bounds", status: cameraBoundsOk ? "pass" : "fail", message: cameraBoundsOk ? "all poses normalized" : "pose escaped normalized bounds" });
  const targetSafe = manifest.events.every((event) => {
    const scene = storyboard.scenes.find((item) => item.id === event.sceneId);
    const focusTime = Math.min(event.timestampMs + event.durationMs - 1, event.timestampMs + (scene?.camera.transitionMs ?? 560) + 100);
    return targetInsideSafeArea(event.boundingBox, sampleCameraTrack(track, focusTime).pose, { width: 1440, height: 1080 }, 24);
  });
  structuralChecks.push({ name: "target-safe-area", status: targetSafe ? "pass" : "warn", message: targetSafe ? "all captured targets remain inside the safe area" : "one or more targets approach the frame edge" });
  const jump = track.frames.slice(1).some((frame, index) => poseTravelPx(track.frames[index]!.pose, frame.pose, { width: 1440, height: 1080 }) > 720 && frame.timeMs - track.frames[index]!.timeMs < 220);
  structuralChecks.push({ name: "camera-jump", status: jump ? "warn" : "pass", message: jump ? "a rapid pose change needs visual review" : "no rapid pose jump detected" });
  const annotationsPresent = manifest.events.every((event) => storyboard.scenes.find((scene) => scene.id === event.sceneId)?.annotations.length);
  structuralChecks.push({ name: "annotations-present", status: annotationsPresent ? "pass" : "fail", message: annotationsPresent ? "each capture event has annotation data" : "an event has no annotation data" });
  const captionsFit = timeline.segments.every((segment) => wrapCaption(segment.text).split("\n").every((line) => line.length <= 20));
  structuralChecks.push({ name: "subtitle-safe-area", status: captionsFit ? "pass" : "warn", message: captionsFit ? "caption lines fit the configured width" : "caption wrapping needs review" });
  const [black, white, frozen] = await Promise.all([
    inspectVideoFilter(finalPath, "blackdetect=d=0.25:pix_th=0.01", /black_duration:/i),
    inspectVideoFilter(finalPath, "signalstats,metadata=print:file=-", /YAVG=25[0-5](?:\.\d+)?/i),
    inspectVideoFilter(finalPath, "freezedetect=n=0.003:d=0.8", /freeze_duration:/i),
  ]);
  structuralChecks.push({ name: "black-frames", status: black.detected ? "fail" : black.output.includes("exited") ? "warn" : "pass", message: black.detected ? "black frame detected" : "no sustained black frame detected" });
  structuralChecks.push({ name: "white-frames", status: white.detected ? "fail" : white.output.includes("exited") ? "warn" : "pass", message: white.detected ? "white frame detected" : "no sustained white frame detected" });
  structuralChecks.push({ name: "freeze", status: frozen.detected ? "warn" : frozen.output.includes("exited") ? "warn" : "pass", message: frozen.detected ? "freeze detector reported a sustained frame" : "no sustained freeze detected" });
  const avDelta = probe.hasAudio && probe.videoDurationMs !== undefined && probe.audioDurationMs !== undefined ? Math.abs(probe.videoDurationMs - probe.audioDurationMs) : Number.POSITIVE_INFINITY;
  structuralChecks.push({ name: "audio-video-end-delta", status: avDelta <= 650 ? "pass" : "warn", message: `${avDelta}ms` });
  const checks = [
    { name: "resolution", status: probe.width === 1440 && probe.height === 1080 ? "pass" : "fail", message: `${probe.width}x${probe.height}` },
    { name: "fps", status: probe.fps !== undefined && Math.abs(probe.fps - 30) < 0.1 ? "pass" : "fail", message: `${probe.fps ?? "unknown"} fps` },
    { name: "h264", status: probe.videoCodec === "h264" ? "pass" : "fail", message: probe.videoCodec ?? "missing" },
    { name: "audio", status: probe.hasAudio ? "pass" : "fail", message: probe.audioCodec ?? "missing" },
    { name: "duration", status: probe.durationMs >= 11500 && probe.durationMs <= 12500 ? "pass" : "warn", message: `${probe.durationMs}ms` },
    ...structuralChecks,
    { name: "cover-4x3", status: (await probeMedia(covers.landscape)).width === 1200 && (await probeMedia(covers.landscape)).height === 900 ? "pass" : "fail", message: covers.landscape },
    { name: "cover-3x4", status: (await probeMedia(covers.portrait)).width === 900 && (await probeMedia(covers.portrait)).height === 1200 ? "pass" : "fail", message: covers.portrait },
  ] as Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }>;
  const status = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass";
  await writeJson(join(outputDir, "quality.json"), { status, checks });
  await markStage(dir, "render", input);
  if (status === "fail") throw new Error(`Render QA failed: ${JSON.stringify(checks)}`);
  console.log(`Final video: ${finalPath}`);
}

async function runExport(name: string): Promise<void> {
  const outputDir = join(root, "output", slug(name));
  const finalPath = join(outputDir, "final.mp4");
  const required = [finalPath, join(outputDir, "clean.mp4"), join(outputDir, "capture.mp4"), join(outputDir, "narration.wav"), join(outputDir, "timeline.json"), join(outputDir, "subtitle.srt"), join(outputDir, "quality.json"), join(outputDir, "cover-4x3.png"), join(outputDir, "cover-3x4.png")];
  for (const file of required) await access(file);
  console.log(`Export ready: ${finalPath}`);
}

async function runAll(url: string): Promise<void> {
  const { projectDir, analysis } = await getOrAnalyze(url, "demo");
  const name = projectDir.split(/[\\/]/).pop() ?? slug(analysis.name);
  await runScript(name);
  await runStoryboard(name);
  await runTts(name);
  await runCapture(name);
  await runRender(name);
}

const program = new Command();
program.name("video").description("GitHub Video Studio pipeline");
program.command("analyze").argument("<url>").option("-p, --project <name>").action(runAnalyze);
program.command("script").argument("<project>").action(runScript);
program.command("storyboard").argument("<project>").action(runStoryboard);
program.command("tts").argument("<project>").action(runTts);
program.command("capture").argument("<project>").action(runCapture);
program.command("render").argument("<project>").action(runRender);
program.command("export").argument("<project>").action(runExport);
program.command("run").argument("<url>").action(runAll);
program.parseAsync().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const stage = process.argv[2];
  const project = process.argv[3];
  if (project && stage && ["analyze", "script", "storyboard", "tts", "capture", "render", "export"].includes(stage)) {
    await writeJson(join(projectPath(project), `${stage}-error.json`), { stage, message, updatedAt: new Date().toISOString() });
  }
  console.error(message);
  process.exitCode = 1;
});
