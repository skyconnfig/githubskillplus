import { bundle, type BundleOptions } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AudioTimeline, CameraTrack, CaptureEvent, DirectorPlan, PointerSample, ScriptDocument, StoryboardDocument, TargetTrack, VideoAspect, WordTimeline } from "../../../packages/shared/src/types.js";
import { planCameraTrack } from "../../../packages/camera-engine/src/index.js";
import { generateSrt } from "../../../packages/subtitle-engine/src/index.js";

type MinimalWebpackConfig = {
  resolve?: { extensionAlias?: Record<string, string[]>; [key: string]: unknown };
  [key: string]: unknown;
};

const webpackOverride: NonNullable<BundleOptions["webpackOverride"]> = ((config: MinimalWebpackConfig): MinimalWebpackConfig => ({
  ...config,
  resolve: { ...config.resolve, extensionAlias: { ...config.resolve?.extensionAlias, ".js": [".ts", ".tsx", ".js"] } },
})) as unknown as NonNullable<BundleOptions["webpackOverride"]>;

export interface RenderInput {
  captureVideo: string;
  captureStartMs: number;
  narrationAudio: string;
  audioTimeline: AudioTimeline;
  wordTimeline?: WordTimeline;
  directorPlan?: DirectorPlan;
  captureEvents: CaptureEvent[];
  targetTracks?: TargetTrack[];
  pointerTrack?: PointerSample[];
  storyboard: StoryboardDocument;
  script?: ScriptDocument;
  outputPath: string;
  aspect?: VideoAspect;
  includeAudio?: boolean;
  includeVisuals?: boolean;
  includeSubtitles?: boolean;
}

export interface RenderContext {
  serveUrl: string;
  publicDir: string;
  outputDir: string;
}

function videoCompositionId(aspect: VideoAspect): string {
  if (aspect === "16:9") return "GithubDemo16x9";
  if (aspect === "3:4") return "GithubDemo3x4";
  if (aspect === "9:16") return "GithubDemo9x16";
  return "GithubDemo";
}

export async function createRenderContext(input: { captureVideo: string; narrationAudio: string; outputDir: string }): Promise<RenderContext> {
  const outputDir = resolve(input.outputDir);
  const workDir = join(outputDir, ".remotion");
  const publicDir = join(workDir, "public");
  await mkdir(publicDir, { recursive: true });
  await copyFile(input.captureVideo, join(publicDir, "capture.mp4"));
  await copyFile(input.narrationAudio, join(publicDir, "narration.wav"));
  const serveUrl = await bundle({ entryPoint: resolve("remotion/src/index.tsx"), publicDir, webpackOverride });
  return { serveUrl, publicDir, outputDir };
}

function buildProps(input: RenderInput, cameraTrack: CameraTrack): Record<string, unknown> {
  const subtitleEntries = input.audioTimeline.segments.map((segment) => {
    const line = input.script?.lines.find((item) => item.id === segment.lineId);
    return { startMs: segment.startMs, endMs: segment.endMs, text: segment.text, keyword: line?.keyword };
  });
  return {
    captureVideo: "capture.mp4",
    narrationAudio: "narration.wav",
    captureStartMs: input.captureStartMs,
    cameraTrack,
    captureEvents: input.captureEvents,
    targetTracks: input.targetTracks ?? [],
    pointerTrack: input.pointerTrack ?? [],
    wordTimeline: input.wordTimeline ?? { schemaVersion: 1, words: [] },
    storyboard: { scenes: input.storyboard.scenes },
    subtitles: input.includeSubtitles === false ? [] : subtitleEntries,
    showAnnotations: input.includeVisuals !== false,
    showCursor: input.includeVisuals !== false,
    showSubtitles: input.includeSubtitles !== false,
    includeAudio: input.includeAudio !== false,
  };
}

async function renderProjectWithContext(input: RenderInput, context: RenderContext): Promise<{ outputPath: string; cameraTrack: CameraTrack }> {
  const outputPath = resolve(input.outputPath);
  const aspect = input.aspect ?? input.storyboard.project.aspect;
  const cameraTrack = planCameraTrack(input.captureEvents, input.storyboard.scenes, input.audioTimeline, { viewport: { width: 1440, height: 1080 } });
  const props = buildProps(input, cameraTrack);
  await writeFile(join(dirname(outputPath), "timeline.json"), JSON.stringify({ audio: input.audioTimeline, words: input.wordTimeline ?? null, director: input.directorPlan ?? null, camera: cameraTrack }, null, 2), "utf8");
  await writeFile(join(dirname(outputPath), "subtitle.srt"), generateSrt(input.audioTimeline), "utf8");
  const selected = await selectComposition({ serveUrl: context.serveUrl, id: videoCompositionId(aspect), inputProps: props });
  const composition = { ...selected, durationInFrames: Math.max(1, Math.ceil(input.audioTimeline.totalDurationMs / 1000 * 30)) };
  await mkdir(dirname(outputPath), { recursive: true });
  await renderMedia({ composition, serveUrl: context.serveUrl, codec: "h264", outputLocation: outputPath, inputProps: props, ...(input.includeAudio === false ? {} : { audioCodec: "aac" }), crf: 18, pixelFormat: "yuv420p" });
  return { outputPath, cameraTrack };
}

export async function renderProject(input: RenderInput, context?: RenderContext): Promise<{ outputPath: string; cameraTrack: CameraTrack }> {
  const ownContext = context ?? await createRenderContext({ captureVideo: input.captureVideo, narrationAudio: input.narrationAudio, outputDir: dirname(input.outputPath) });
  return renderProjectWithContext(input, ownContext);
}

export async function renderPreview(input: RenderInput, outputPath: string, frame = 0, context?: RenderContext): Promise<string> {
  const ownContext = context ?? await createRenderContext({ captureVideo: input.captureVideo, narrationAudio: input.narrationAudio, outputDir: dirname(outputPath) });
  const aspect = input.aspect ?? input.storyboard.project.aspect;
  const cameraTrack = planCameraTrack(input.captureEvents, input.storyboard.scenes, input.audioTimeline, { viewport: { width: 1440, height: 1080 } });
  const props = buildProps(input, cameraTrack);
  const selected = await selectComposition({ serveUrl: ownContext.serveUrl, id: videoCompositionId(aspect), inputProps: props });
  await renderStill({ composition: selected, serveUrl: ownContext.serveUrl, frame: Math.max(0, Math.min(selected.durationInFrames - 1, frame)), output: resolve(outputPath), inputProps: props });
  return resolve(outputPath);
}

export async function renderCovers(storyboard: StoryboardDocument, outputDir: string, context?: RenderContext): Promise<Record<"landscape" | "portrait" | "wide" | "vertical", string>> {
  const ownContext = context ?? await bundleContextForCovers(outputDir);
  const root = resolve(outputDir);
  const specs = [
    { key: "landscape" as const, id: "GithubCover4x3", variant: "4x3" as const, width: 1200, height: 900, file: "cover-4x3.png" },
    { key: "portrait" as const, id: "GithubCover3x4", variant: "3x4" as const, width: 900, height: 1200, file: "cover-3x4.png" },
    { key: "wide" as const, id: "GithubCover16x9", variant: "16x9" as const, width: 1920, height: 1080, file: "cover-16x9.png" },
    { key: "vertical" as const, id: "GithubCover9x16", variant: "9x16" as const, width: 1080, height: 1920, file: "cover-9x16.png" },
  ];
  const output = {} as Record<"landscape" | "portrait" | "wide" | "vertical", string>;
  for (const spec of specs) {
    const path = join(root, spec.file);
    const inputProps = { title: storyboard.project.title, repoUrl: storyboard.project.githubUrl, variant: spec.variant };
    const composition = await selectComposition({ serveUrl: ownContext.serveUrl, id: spec.id, inputProps });
    await renderStill({ composition, serveUrl: ownContext.serveUrl, frame: 0, output: path, inputProps });
    output[spec.key] = path;
  }
  return output;
}

async function bundleContextForCovers(outputDir: string): Promise<RenderContext> {
  const workDir = join(resolve(outputDir), ".covers");
  await mkdir(workDir, { recursive: true });
  const serveUrl = await bundle({ entryPoint: resolve("remotion/src/index.tsx"), publicDir: workDir, webpackOverride });
  return { serveUrl, publicDir: workDir, outputDir: resolve(outputDir) };
}
