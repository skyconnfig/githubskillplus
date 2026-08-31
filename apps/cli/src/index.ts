import { Command } from "commander";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseGitHubUrl, analyzeRepository } from "../../../packages/github-analyzer/src/index.js";
import { buildEvidenceGraph } from "../../../packages/evidence-engine/src/index.js";
import { generateScript, compactScript, validateDocument } from "../../../packages/script-engine/src/index.js";
import { buildWordTimeline } from "../../../packages/alignment-engine/src/index.js";
import { buildDirectorPlan } from "../../../packages/director-engine/src/index.js";
import { buildStoryboard, getVideoTemplate } from "../../../packages/storyboard/src/index.js";
import { buildAudioTimeline, assertVoiceExists, checkTtsBridge } from "../../../packages/tts-engine/src/index.js";
import { captureStoryboard } from "../../../packages/browser-capture/src/index.js";
import { convertToMp4, inspectVideoFilter, padAudio, probeMedia, stripAudio } from "../../../packages/ffmpeg-utils/src/index.js";
import { createRenderContext, renderCovers, renderPreview, renderProject } from "../../../packages/renderer/src/render.js";
import { buildDirectorQualityChecks, buildTrackQualityChecks, storyboardQualityChecks, summarizeQuality } from "../../../packages/qa-engine/src/index.js";
import { poseTravelPx, sampleCameraTrack, targetInsideSafeArea } from "../../../packages/camera-engine/src/index.js";
import { wrapCaption } from "../../../packages/subtitle-engine/src/index.js";
import { parseAudioTimeline, parseCaptureManifest, parseDirectorPlan, parseEvidenceDocument, parseScriptDocument, parseStoryboardDocument, parseWordTimeline } from "../../../packages/shared/src/schemas.js";
import type { AudioTimeline, CaptureManifest, EvidenceDocument, GitHubAnalysis, ScriptDocument, StoryboardDocument, VideoAspect, VideoTemplate, WordTimeline } from "../../../packages/shared/src/types.js";

const root = resolve(process.cwd());
const projectsRoot = join(root, "projects");
const CAPTURE_PIPELINE_VERSION = "capture-v6-director-pointer-scroll-target-track";
const RENDER_PIPELINE_VERSION = "render-v11-context-aspect-template-word-director-track-safe-area-qa";
const PIPELINE_STAGES = ["analyze", "evidence", "script", "tts", "align", "direct", "storyboard", "capture", "render"] as const;
type PipelineStage = (typeof PIPELINE_STAGES)[number];

function loadDotEnv(): void {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadDotEnv();

interface CliOptions {
  project?: string;
  template?: string;
  aspect?: string;
  offline?: boolean;
  force?: boolean;
  from?: string;
  input?: string;
  scene?: string;
  start?: string;
  end?: string;
}

interface ProjectConfig { templateId: VideoTemplate["id"]; aspect: VideoAspect }

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "github-project";
}

function projectPath(name: string): string { return join(projectsRoot, slug(name)); }

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(path, { force: true });
  await (await import("node:fs/promises")).rename(temp, path);
}

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }

async function readParsed<T>(path: string, parser: (value: unknown) => T): Promise<T> { return parser(await readJson<unknown>(path)); }

async function ensureProject(name: string): Promise<string> {
  const path = projectPath(name);
  await mkdir(path, { recursive: true });
  return path;
}

function fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function loadState(projectDir: string): Promise<{ config?: ProjectConfig; stages?: Record<string, { inputHash: string; updatedAt: string }> }> {
  try { return await readJson(join(projectDir, "state.json")); } catch { return {}; }
}

async function saveConfig(projectDir: string, config: ProjectConfig): Promise<void> {
  const state = await loadState(projectDir);
  await writeJson(join(projectDir, "state.json"), { ...state, config, updatedAt: new Date().toISOString() });
}

async function markStage(projectDir: string, stage: string, input: unknown): Promise<void> {
  const previous = await loadState(projectDir);
  const stages = previous.stages ?? {};
  stages[stage] = { inputHash: fingerprint(input), updatedAt: new Date().toISOString() };
  await writeJson(join(projectDir, "state.json"), { ...previous, stage, inputHash: fingerprint(input), updatedAt: new Date().toISOString(), stages });
  await rm(join(projectDir, `${stage}-error.json`), { force: true });
}

async function stageIsCurrent(projectDir: string, stage: string, input: unknown, files: string[], force = false): Promise<boolean> {
  if (force) return false;
  const state = await loadState(projectDir);
  return state.stages?.[stage]?.inputHash === fingerprint(input) && files.every((file) => existsSync(isAbsolute(file) ? file : join(projectDir, file)));
}

function templateFrom(value: string | undefined, fallback: VideoTemplate["id"] = "45s"): VideoTemplate {
  const id = value ?? fallback;
  if (id !== "12s" && id !== "30s" && id !== "45s" && id !== "60s") throw new Error(`Unknown template: ${id}`);
  return getVideoTemplate(id);
}

function aspectFrom(value: string | undefined, fallback: VideoAspect): VideoAspect {
  const aspect = value ?? fallback;
  if (aspect !== "16:9" && aspect !== "4:3" && aspect !== "3:4" && aspect !== "9:16") throw new Error(`Unknown aspect: ${aspect}`);
  return aspect;
}

function capturedTargetBoxAt(manifest: CaptureManifest, event: CaptureManifest["events"][number], timeMs: number): CaptureManifest["events"][number]["boundingBox"] {
  const track = manifest.targetTracks.find((item) => item.targetId === event.targetId);
  const samples = track?.samples.filter((sample) => sample.visible) ?? [];
  if (samples.length === 0) return event.boundingBox;
  const next = samples.find((sample) => sample.timeMs >= timeMs) ?? samples[samples.length - 1]!;
  const previous = [...samples].reverse().find((sample) => sample.timeMs <= timeMs) ?? samples[0]!;
  const progress = Math.max(0, Math.min(1, (timeMs - previous.timeMs) / Math.max(1, next.timeMs - previous.timeMs)));
  return {
    x: previous.x + (next.x - previous.x) * progress,
    y: previous.y + (next.y - previous.y) * progress,
    width: previous.width + (next.width - previous.width) * progress,
    height: previous.height + (next.height - previous.height) * progress,
  };
}

async function projectConfig(projectDir: string, options: CliOptions = {}): Promise<ProjectConfig> {
  const state = await loadState(projectDir);
  const template = templateFrom(options.template, state.config?.templateId ?? "45s");
  const config = { templateId: template.id, aspect: aspectFrom(options.aspect, state.config?.aspect ?? template.aspect) } satisfies ProjectConfig;
  await saveConfig(projectDir, config);
  return config;
}

async function startBridge(): Promise<{ stop: () => void }> {
  const baseUrl = process.env.INDEXTTS_BRIDGE_URL ?? "http://127.0.0.1:8125";
  if (await checkTtsBridge(baseUrl)) return { stop: () => undefined };
  const python = process.env.INDEXTTS_PYTHON ?? "D:\\AI\\indextts\\.venv\\Scripts\\python.exe";
  const server = resolve(root, "services/indextts-bridge/server.py");
  if (!existsSync(python)) throw new Error(`IndexTTS Python not found: ${python}`);
  const child = spawn(python, [server], {
    cwd: process.env.INDEXTTS_ROOT ?? "D:\\AI\\indextts",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OMP_NUM_THREADS: process.env.OMP_NUM_THREADS ?? "1",
      MKL_NUM_THREADS: process.env.MKL_NUM_THREADS ?? "1",
      OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS ?? "1",
      TORCH_NUM_THREADS: process.env.TORCH_NUM_THREADS ?? "1",
      TORCH_NUM_INTEROP_THREADS: process.env.TORCH_NUM_INTEROP_THREADS ?? "1",
    },
  });
  child.stdout.on("data", (chunk: Buffer) => process.stdout.write(`[indextts] ${chunk.toString()}`));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[indextts] ${chunk.toString()}`));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await checkTtsBridge(baseUrl)) return { stop: () => child.kill() };
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  child.kill();
  throw new Error("IndexTTS Bridge did not become healthy within 30 seconds");
}

async function getOrAnalyze(url: string, projectName?: string, force = false): Promise<{ projectDir: string; analysis: GitHubAnalysis }> {
  const analysis = await analyzeRepository(url);
  const parsed = parseGitHubUrl(url);
  const dir = await ensureProject(projectName ?? `${parsed.owner}-${parsed.name}`);
  const current = await stageIsCurrent(dir, "analyze", { url: analysis.githubUrl }, [join(dir, "github.json")], force);
  if (!current) {
    await writeJson(join(dir, "github.json"), analysis);
    await markStage(dir, "analyze", { url: analysis.githubUrl, analyzedAt: analysis.analyzedAt });
  }
  console.log(`Analyzed ${analysis.fullName}: ${analysis.stars} stars, ${analysis.sections.length} README sections`);
  return { projectDir: dir, analysis };
}

async function runAnalyze(url: string, options: CliOptions): Promise<void> { await getOrAnalyze(url, options.project, options.force); }

async function runEvidence(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const analysis = await readJson<GitHubAnalysis>(join(dir, "github.json"));
  const evidence = buildEvidenceGraph(analysis, slug(name));
  const input = { analysis, version: "evidence-v1" };
  if (await stageIsCurrent(dir, "evidence", input, [join(dir, "evidence.json")], options.force)) return;
  await writeJson(join(dir, "evidence.json"), evidence);
  await markStage(dir, "evidence", input);
  console.log(`Evidence written: ${evidence.items.length} items`);
}

async function importManualScript(inputPath: string, analysis: GitHubAnalysis, evidence: EvidenceDocument, template: VideoTemplate): Promise<ScriptDocument> {
  const raw = await readFile(inputPath, "utf8");
  if (inputPath.toLowerCase().endsWith(".json")) {
    const value = JSON.parse(raw) as Record<string, unknown>;
    value.schemaVersion = 1;
    value.githubUrl = analysis.githubUrl;
    value.targetDurationMs = template.durationMs;
    return validateDocument(value, analysis, evidence);
  }
  const first = evidence.items[0];
  if (!first) throw new Error("Manual text import requires at least one evidence item");
  const lines = raw.split(/\r?\n/).map((text) => text.trim()).filter(Boolean);
  return { schemaVersion: 1, projectName: slug(`${analysis.owner}-${analysis.name}`), githubUrl: analysis.githubUrl, targetDurationMs: template.durationMs, lines: lines.map((text, index) => ({ id: `line-${String(index + 1).padStart(2, "0")}`, text, keyword: text.slice(0, 12), visualIntent: "feature", githubTarget: first.target, importance: 1 as const, evidenceIds: [first.id] })) };
}

async function runScript(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const analysis = await readJson<GitHubAnalysis>(join(dir, "github.json"));
  const evidence = await readParsed(join(dir, "evidence.json"), parseEvidenceDocument).catch(() => buildEvidenceGraph(analysis, slug(name)));
  if (!existsSync(join(dir, "evidence.json"))) await writeJson(join(dir, "evidence.json"), evidence);
  const config = await projectConfig(dir, options);
  const template = templateFrom(config.templateId);
  const script = options.input ? await importManualScript(resolve(options.input), analysis, evidence, template) : await generateScript(analysis, { offline: options.offline, evidence, template });
  const input = { evidence, template, script };
  if (await stageIsCurrent(dir, "script", input, [join(dir, "script.json")], options.force)) return;
  await writeJson(join(dir, "script.json"), script);
  await markStage(dir, "script", input);
  console.log(`Script written: ${join(dir, "script.json")}`);
}

async function runTts(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  let script = await readParsed(join(dir, "script.json"), parseScriptDocument);
  const evidence = await readParsed(join(dir, "evidence.json"), parseEvidenceDocument);
  const config = await projectConfig(dir, options);
  const template = templateFrom(config.templateId);
  const voicePath = process.env.INDEXTTS_VOICE ?? "D:\\AI\\indextts\\voice_8yue19.wav";
  await assertVoiceExists(voicePath);
  const bridge = await startBridge();
  try {
    const ttsOptions = { baseUrl: process.env.INDEXTTS_BRIDGE_URL ?? "http://127.0.0.1:8125", voicePath, lang: "zh" as const, cacheDir: join(dir, "audio", "cache") };
    let timeline = await buildAudioTimeline(script, ttsOptions, join(dir, "audio"));
    const hasOverlongTwelveSecondSegment = template.id === "12s" && timeline.segments.some((segment) => segment.durationMs > 4000);
    if ((timeline.totalDurationMs > template.durationMs || hasOverlongTwelveSecondSegment) && template.id === "12s") {
      script = compactScript((await readJson<GitHubAnalysis>(join(dir, "github.json"))), evidence);
      await writeJson(join(dir, "script.json"), script);
      timeline = await buildAudioTimeline(script, ttsOptions, join(dir, "audio"), { slotDurationMs: 4000 });
    } else if (template.id === "12s") {
      timeline = await buildAudioTimeline(script, ttsOptions, join(dir, "audio"), { slotDurationMs: 4000 });
    }
    if (timeline.totalDurationMs > template.durationMs) throw new Error(`IndexTTS audio is ${timeline.totalDurationMs}ms, over ${template.id} template ${template.durationMs}ms`);
    // The 12s MVP has three fixed four-second slots. Longer templates use
    // the measured TTS duration as their clock; padding them would create a
    // silent tail while the scene timeline still ends at the last sentence.
    if (template.id === "12s" && timeline.totalDurationMs < template.durationMs) {
      const paddedPath = join(dir, "audio", `narration-${template.id}.wav`);
      await padAudio(timeline.audioPath, paddedPath, template.durationMs);
      timeline = { ...timeline, audioPath: paddedPath, totalDurationMs: template.durationMs };
    }
    const input = { script, voicePath, template, timeline };
    if (await stageIsCurrent(dir, "tts", input, [join(dir, "timeline-audio.json"), timeline.audioPath], options.force)) return;
    await writeJson(join(dir, "timeline-audio.json"), timeline);
    await markStage(dir, "tts", input);
    console.log(`TTS written: ${timeline.totalDurationMs}ms`);
  } finally {
    bridge.stop();
  }
}

async function runAlign(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const audio = await readParsed(join(dir, "timeline-audio.json"), parseAudioTimeline);
  const words = await buildWordTimeline(audio);
  if (await stageIsCurrent(dir, "align", { audio }, [join(dir, "word-timeline.json")], options.force)) return;
  await writeJson(join(dir, "word-timeline.json"), words);
  await markStage(dir, "align", { audio });
  console.log(`Word timeline written: ${words.words.length} words`);
}

async function runDirect(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const analysis = await readJson<GitHubAnalysis>(join(dir, "github.json"));
  const evidence = await readParsed(join(dir, "evidence.json"), parseEvidenceDocument);
  const script = await readParsed(join(dir, "script.json"), parseScriptDocument);
  const audio = await readParsed(join(dir, "timeline-audio.json"), parseAudioTimeline);
  const words = await readParsed(join(dir, "word-timeline.json"), parseWordTimeline);
  const config = await projectConfig(dir, options);
  const template = templateFrom(config.templateId);
  const plan = buildDirectorPlan(script, evidence, audio, words, { template, aspect: config.aspect });
  if (await stageIsCurrent(dir, "direct", { analysis, evidence, script, audio, words, config }, [join(dir, "director-plan.json")], options.force)) return;
  await writeJson(join(dir, "director-plan.json"), plan);
  await markStage(dir, "direct", { analysis, evidence, script, audio, words, config });
  console.log(`Director plan written: ${plan.beats.length} beats`);
}

async function runStoryboard(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const analysis = await readJson<GitHubAnalysis>(join(dir, "github.json"));
  const script = await readParsed(join(dir, "script.json"), parseScriptDocument);
  const audio = await readParsed(join(dir, "timeline-audio.json"), parseAudioTimeline);
  const director = await readParsed(join(dir, "director-plan.json"), parseDirectorPlan);
  const config = await projectConfig(dir, options);
  const storyboard = buildStoryboard(analysis, script, { audioTimeline: audio, directorPlan: director, templateId: config.templateId, aspect: config.aspect });
  if (await stageIsCurrent(dir, "storyboard", { script, audio, director, config }, [join(dir, "storyboard.json")], options.force)) return;
  await writeJson(join(dir, "storyboard.json"), storyboard);
  await markStage(dir, "storyboard", { script, audio, director, config });
  console.log(`Storyboard written with ${storyboard.scenes.length} scenes`);
}

async function runCapture(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const storyboard = await readParsed(join(dir, "storyboard.json"), parseStoryboardDocument);
  const timeline = await readParsed(join(dir, "timeline-audio.json"), parseAudioTimeline);
  const director = await readParsed(join(dir, "director-plan.json"), parseDirectorPlan);
  const input = { version: CAPTURE_PIPELINE_VERSION, storyboard, timeline, director };
  const files = ["capture/capture-manifest.json", "capture/capture.webm", "capture/pointer-track.json", "capture/scroll-track.json", "capture/target-tracks.json"];
  if (await stageIsCurrent(dir, "capture", input, files, options.force)) return;
  const manifest = await captureStoryboard(storyboard, timeline, join(dir, "capture"), { directorPlan: director, samplingHz: 60 });
  await markStage(dir, "capture", input);
  console.log(`Capture written: ${manifest.videoPath}`);
}

async function runRender(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const storyboard = await readParsed(join(dir, "storyboard.json"), parseStoryboardDocument);
  const script = await readParsed(join(dir, "script.json"), parseScriptDocument);
  const timeline = await readParsed(join(dir, "timeline-audio.json"), parseAudioTimeline);
  const words = await readParsed(join(dir, "word-timeline.json"), parseWordTimeline);
  const director = await readParsed(join(dir, "director-plan.json"), parseDirectorPlan);
  const manifest = await readParsed(join(dir, "capture/capture-manifest.json"), parseCaptureManifest);
  const config = await projectConfig(dir, options);
  const outputDir = join(root, "output", slug(name));
  await mkdir(outputDir, { recursive: true });
  const required = ["final.mp4", "clean.mp4", "quality.json", "cover-4x3.png", "cover-3x4.png", "cover-9x16.png"];
  if (await stageIsCurrent(dir, "render", { version: RENDER_PIPELINE_VERSION, storyboard, script, timeline, words, director, manifest, config }, required.map((file) => join(outputDir, file)), options.force)) return;
  const captureMp4 = join(outputDir, "capture.mp4");
  await convertToMp4(manifest.videoPath, captureMp4);
  const finalPath = join(outputDir, "final.mp4");
  const cleanPath = join(outputDir, "clean.mp4");
  const context = await createRenderContext({ captureVideo: captureMp4, narrationAudio: timeline.audioPath, outputDir });
  const renderInput = { captureVideo: captureMp4, captureStartMs: manifest.videoStartMs, narrationAudio: timeline.audioPath, audioTimeline: timeline, wordTimeline: words, directorPlan: director, captureEvents: manifest.events, targetTracks: manifest.targetTracks, pointerTrack: manifest.pointerTrack, storyboard, script, aspect: config.aspect };
  const finalRender = await renderProject({ ...renderInput, outputPath: finalPath }, context);
  await renderProject({ ...renderInput, outputPath: cleanPath, includeAudio: false, includeVisuals: false, includeSubtitles: false }, context);
  const cleanNoAudioPath = join(outputDir, "clean.noaudio.mp4");
  await stripAudio(cleanPath, cleanNoAudioPath);
  await rm(cleanPath, { force: true });
  await (await import("node:fs/promises")).rename(cleanNoAudioPath, cleanPath);
  const covers = await renderCovers(storyboard, outputDir, context);
  await copyFile(timeline.audioPath, join(outputDir, "narration.wav"));
  await copyFile(join(dir, "word-timeline.json"), join(outputDir, "word-timeline.json"));
  await copyFile(join(dir, "director-plan.json"), join(outputDir, "director-plan.json"));
  await copyFile(finalPath, join(outputDir, "test.mp4"));
  const probe = await probeMedia(finalPath);
  const checks = [
    { name: "resolution", status: probe.width === storyboard.project.width && probe.height === storyboard.project.height ? "pass" : "fail", message: `${probe.width}x${probe.height}` },
    { name: "fps", status: probe.fps !== undefined && Math.abs(probe.fps - 30) < 0.1 ? "pass" : "fail", message: `${probe.fps ?? "unknown"} fps` },
    { name: "h264", status: probe.videoCodec === "h264" ? "pass" : "fail", message: probe.videoCodec ?? "missing" },
    { name: "audio", status: probe.hasAudio ? "pass" : "fail", message: probe.audioCodec ?? "missing" },
    { name: "duration", status: probe.durationMs >= timeline.totalDurationMs - 500 && probe.durationMs <= timeline.totalDurationMs + 1000 ? "pass" : "warn", message: `${probe.durationMs}ms` },
    ...storyboardQualityChecks(storyboard),
    ...buildDirectorQualityChecks(director),
    ...buildTrackQualityChecks(finalRender.cameraTrack, manifest.targetTracks, manifest.pointerTrack, manifest.viewport),
    { name: "target-safe-area", status: manifest.events.every((event) => { const scene = storyboard.scenes.find((item) => item.id === event.sceneId); const sceneEnd = scene?.endMs ?? event.timestampMs + event.durationMs; const focus = Math.max(event.timestampMs, Math.min(event.timestampMs + event.durationMs - 100, sceneEnd - 100)); const target = capturedTargetBoxAt(manifest, event, focus); return targetInsideSafeArea(target, sampleCameraTrack(finalRender.cameraTrack, focus).pose, manifest.viewport, 24); }) ? "pass" : "warn", message: "target safe-area check" },
    { name: "camera-fast-jump", status: finalRender.cameraTrack.frames.slice(1).some((frame, index) => poseTravelPx(finalRender.cameraTrack.frames[index]!.pose, frame.pose, manifest.viewport) > 720 && frame.timeMs - finalRender.cameraTrack.frames[index]!.timeMs < 220) ? "warn" : "pass", message: "camera jump check" },
    { name: "subtitle-overflow", status: timeline.segments.every((segment) => wrapCaption(segment.text, 18).split("\n").length <= 2) ? "pass" : "warn", message: "subtitle lines fit two-line safe area" },
    { name: "annotation-too-short", status: storyboard.scenes.every((scene) => scene.annotations.every((annotation) => annotation.enterMs >= 160)) ? "pass" : "warn", message: "annotation entrance duration" },
    { name: "black-frames", status: (await inspectVideoFilter(finalPath, "blackdetect=d=0.25:pix_th=0.01", /black_duration:/i)).detected ? "fail" : "pass", message: "black frame check" },
    { name: "white-frames", status: (await inspectVideoFilter(finalPath, "signalstats,metadata=print:file=-", /YAVG=25[0-5](?:\\.\\d+)?/i)).detected ? "fail" : "pass", message: "white frame check" },
    { name: "freeze", status: (await inspectVideoFilter(finalPath, "freezedetect=n=0.003:d=0.8", /freeze_duration:/i)).detected ? "warn" : "pass", message: "freeze detector" },
    { name: "audio-video-end-delta", status: probe.hasAudio && probe.videoDurationMs !== undefined && probe.audioDurationMs !== undefined && Math.abs(probe.videoDurationMs - probe.audioDurationMs) <= 650 ? "pass" : "warn", message: `${probe.videoDurationMs ?? "?"}/${probe.audioDurationMs ?? "?"}ms` },
    { name: "cover-4x3", status: (await probeMedia(covers.landscape)).width === 1200 && (await probeMedia(covers.landscape)).height === 900 ? "pass" : "fail", message: covers.landscape },
    { name: "cover-3x4", status: (await probeMedia(covers.portrait)).width === 900 && (await probeMedia(covers.portrait)).height === 1200 ? "pass" : "fail", message: covers.portrait },
    { name: "cover-9x16", status: (await probeMedia(covers.vertical)).width === 1080 && (await probeMedia(covers.vertical)).height === 1920 ? "pass" : "fail", message: covers.vertical },
  ] as Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }>;
  const report = summarizeQuality(checks);
  await writeJson(join(outputDir, "quality.json"), report);
  await markStage(dir, "render", { version: RENDER_PIPELINE_VERSION, storyboard, script, timeline, words, director, manifest, config });
  if (report.status === "fail") throw new Error(`Render QA failed: ${JSON.stringify(report.checks)}`);
  console.log(`Final video: ${finalPath}`);
}

async function runPreview(name: string, options: CliOptions = {}): Promise<void> {
  const dir = projectPath(name);
  const storyboard = await readParsed(join(dir, "storyboard.json"), parseStoryboardDocument);
  const script = await readParsed(join(dir, "script.json"), parseScriptDocument);
  const timeline = await readParsed(join(dir, "timeline-audio.json"), parseAudioTimeline);
  const words = await readParsed(join(dir, "word-timeline.json"), parseWordTimeline);
  const director = await readParsed(join(dir, "director-plan.json"), parseDirectorPlan);
  const manifest = await readParsed(join(dir, "capture/capture-manifest.json"), parseCaptureManifest);
  const outputDir = join(root, "output", slug(name));
  const captureMp4 = join(outputDir, "capture.mp4");
  if (!existsSync(captureMp4)) await convertToMp4(manifest.videoPath, captureMp4);
  const context = await createRenderContext({ captureVideo: captureMp4, narrationAudio: timeline.audioPath, outputDir });
  const scene = options.scene ? storyboard.scenes.find((item) => item.id === options.scene) : undefined;
  const start = scene?.startMs ?? Number(options.start ?? 0) * 1000;
  const frame = Math.max(0, Math.round(start / 1000 * storyboard.project.fps));
  const previewPath = join(outputDir, `preview-${options.scene ?? `${Math.round(start / 1000)}s`}.png`);
  await renderPreview({ captureVideo: captureMp4, captureStartMs: manifest.videoStartMs, narrationAudio: timeline.audioPath, audioTimeline: timeline, wordTimeline: words, directorPlan: director, captureEvents: manifest.events, targetTracks: manifest.targetTracks, pointerTrack: manifest.pointerTrack, storyboard, script, aspect: storyboard.project.aspect, outputPath: previewPath }, previewPath, frame, context);
  console.log(`Preview written: ${previewPath}`);
}

async function runExport(name: string): Promise<void> {
  const outputDir = join(root, "output", slug(name));
  const required = ["final.mp4", "clean.mp4", "capture.mp4", "narration.wav", "timeline.json", "subtitle.srt", "word-timeline.json", "director-plan.json", "quality.json", "cover-4x3.png", "cover-3x4.png", "cover-9x16.png"];
  for (const file of required) await access(join(outputDir, file));
  console.log(`Export ready: ${join(outputDir, "final.mp4")}`);
}

async function runAll(url: string, options: CliOptions): Promise<void> {
  const parsed = parseGitHubUrl(url);
  const name = options.project ?? `${parsed.owner}-${parsed.name}`;
  const from = options.from ?? "analyze";
  const start = PIPELINE_STAGES.indexOf(from as PipelineStage);
  if (start < 0) throw new Error(`Unknown --from stage: ${from}`);
  if (start <= 0) await runAnalyze(url, { ...options, project: name });
  else await ensureProject(name);
  if (start <= 1) await runEvidence(name, options);
  if (start <= 2) await runScript(name, options);
  if (start <= 3) await runTts(name, options);
  if (start <= 4) await runAlign(name, options);
  if (start <= 5) await runDirect(name, options);
  if (start <= 6) await runStoryboard(name, options);
  if (start <= 7) await runCapture(name, options);
  if (start <= 8) await runRender(name, options);
}

const program = new Command();
program.name("video").description("GitHub Video Studio Director pipeline");
const addCommon = (command: Command): Command => command.option("-p, --project <name>").option("--template <template>", "12s | 30s | 45s | 60s").option("--aspect <aspect>", "16:9 | 4:3 | 3:4 | 9:16").option("--offline").option("--force");
addCommon(program.command("analyze").argument("<url>")).action((url: string, options: CliOptions) => runAnalyze(url, options));
addCommon(program.command("evidence").argument("<project>")).action((project: string, options: CliOptions) => runEvidence(project, options));
addCommon(program.command("script").argument("<project>").option("-i, --input <path>")).action((project: string, options: CliOptions) => runScript(project, options));
addCommon(program.command("tts").argument("<project>")).action((project: string, options: CliOptions) => runTts(project, options));
addCommon(program.command("align").argument("<project>")).action((project: string, options: CliOptions) => runAlign(project, options));
addCommon(program.command("direct").argument("<project>")).action((project: string, options: CliOptions) => runDirect(project, options));
addCommon(program.command("storyboard").argument("<project>")).action((project: string, options: CliOptions) => runStoryboard(project, options));
addCommon(program.command("capture").argument("<project>")).action((project: string, options: CliOptions) => runCapture(project, options));
addCommon(program.command("render").argument("<project>")).action((project: string, options: CliOptions) => runRender(project, options));
addCommon(program.command("preview").argument("<project>").option("--scene <scene>").option("--start <seconds>").option("--end <seconds>")).action((project: string, options: CliOptions) => runPreview(project, options));
program.command("export").argument("<project>").action((project: string) => runExport(project));
addCommon(program.command("run").argument("<url>").option("--from <stage>", "analyze | evidence | script | tts | align | direct | storyboard | capture | render")).action((url: string, options: CliOptions) => runAll(url, options));
program.parseAsync().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const stage = process.argv[2];
  const project = process.argv[3];
  if (project && stage && [...PIPELINE_STAGES, "preview", "export"].includes(stage)) await writeJson(join(projectPath(project), `${stage}-error.json`), { stage, message, updatedAt: new Date().toISOString() });
  console.error(message);
  process.exitCode = 1;
});
