import { bundle, type BundleOptions } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AudioTimeline, CameraTrack, CaptureEvent, StoryboardDocument } from "../../../packages/shared/src/types.js";
import { followTargets } from "../../../packages/camera-engine/src/index.js";
import { generateSrt } from "../../../packages/subtitle-engine/src/index.js";

type MinimalWebpackConfig = {
  resolve?: { extensionAlias?: Record<string, string[]>; [key: string]: unknown };
  [key: string]: unknown;
};

const webpackOverride: NonNullable<BundleOptions["webpackOverride"]> = ((config: MinimalWebpackConfig): MinimalWebpackConfig => {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      extensionAlias: {
        ...config.resolve?.extensionAlias,
        ".js": [".ts", ".tsx", ".js"],
      },
    },
  };
}) as unknown as NonNullable<BundleOptions["webpackOverride"]>;

export interface RenderInput {
  captureVideo: string;
  captureStartMs: number;
  narrationAudio: string;
  audioTimeline: AudioTimeline;
  captureEvents: CaptureEvent[];
  storyboard: StoryboardDocument;
  outputPath: string;
  includeAudio?: boolean;
  includeVisuals?: boolean;
  includeSubtitles?: boolean;
}

export async function renderProject(input: RenderInput): Promise<{ outputPath: string; cameraTrack: CameraTrack }> {
  const outputPath = resolve(input.outputPath);
  const workDir = join(dirname(outputPath), ".remotion");
  const publicDir = join(workDir, "public");
  await mkdir(publicDir, { recursive: true });
  await copyFile(input.captureVideo, join(publicDir, "capture.mp4"));
  await copyFile(input.narrationAudio, join(publicDir, "narration.wav"));
  const cameraTrack = followTargets(input.captureEvents, input.audioTimeline);
  const subtitleEntries = input.audioTimeline.segments.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text }));
  const props = { captureVideo: "capture.mp4", narrationAudio: "narration.wav", captureStartMs: input.captureStartMs, cameraTrack, captureEvents: input.captureEvents, storyboard: { scenes: input.storyboard.scenes }, subtitles: input.includeSubtitles === false ? [] : subtitleEntries, showAnnotations: input.includeVisuals !== false, showCursor: input.includeVisuals !== false, showSubtitles: input.includeSubtitles !== false, includeAudio: input.includeAudio !== false };
  await writeFile(join(dirname(outputPath), "timeline.json"), JSON.stringify({ audio: input.audioTimeline, camera: cameraTrack }, null, 2), "utf8");
  await writeFile(join(dirname(outputPath), "subtitle.srt"), generateSrt(input.audioTimeline), "utf8");
  const serveUrl = await bundle({ entryPoint: resolve("remotion/src/index.tsx"), publicDir, webpackOverride });
  const composition = await selectComposition({ serveUrl, id: "GithubDemo", inputProps: props });
  await mkdir(dirname(outputPath), { recursive: true });
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: outputPath, inputProps: props, ...(input.includeAudio === false ? {} : { audioCodec: "aac" }), crf: 18, pixelFormat: "yuv420p" });
  return { outputPath, cameraTrack };
}

export async function renderCovers(storyboard: StoryboardDocument, outputDir: string): Promise<{ landscape: string; portrait: string }> {
  const workDir = join(resolve(outputDir), ".covers");
  await mkdir(workDir, { recursive: true });
  const serveUrl = await bundle({ entryPoint: resolve("remotion/src/index.tsx"), publicDir: workDir, webpackOverride });
  const landscape = join(resolve(outputDir), "cover-4x3.png");
  const portrait = join(resolve(outputDir), "cover-3x4.png");
  const specs = [
    { id: "GithubCover4x3", variant: "4x3" as const, outputLocation: landscape },
    { id: "GithubCover3x4", variant: "3x4" as const, outputLocation: portrait },
  ];
  for (const spec of specs) {
    const inputProps = { title: storyboard.project.title, repoUrl: storyboard.project.githubUrl, variant: spec.variant };
    const composition = await selectComposition({ serveUrl, id: spec.id, inputProps });
    await renderStill({ composition, serveUrl, frame: 0, output: spec.outputLocation, inputProps });
  }
  return { landscape, portrait };
}
