import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";

export interface MediaProbe {
  durationMs: number;
  videoDurationMs?: number;
  audioDurationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
}

export interface FilterProbe {
  detected: boolean;
  output: string;
}

function binary(name: string): string {
  const configured = name === "ffmpeg" ? process.env.FFMPEG_BIN : process.env.FFPROBE_BIN;
  return configured ?? name;
}

export function runProcess(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => reject(new Error(`Failed to start ${command}: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${String(code)}: ${stderr.slice(-1000)}`)));
  });
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  await access(filePath);
  const result = await runProcess(binary("ffprobe"), ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]);
  const raw = JSON.parse(result.stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const streams = raw.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const videoDuration = Number(video?.duration ?? 0);
  const audioDuration = Number(audio?.duration ?? 0);
  const duration = Number(raw.format?.duration ?? Math.max(videoDuration, audioDuration, 0));
  const rate = typeof video?.r_frame_rate === "string" ? video.r_frame_rate.split("/").map(Number) : [];
  const fps = rate.length === 2 && rate[1] ? (rate[0] ?? 0) / rate[1] : undefined;
  return { durationMs: Math.round(duration * 1000), videoDurationMs: videoDuration > 0 ? Math.round(videoDuration * 1000) : undefined, audioDurationMs: audioDuration > 0 ? Math.round(audioDuration * 1000) : undefined, width: typeof video?.width === "number" ? video.width : undefined, height: typeof video?.height === "number" ? video.height : undefined, fps, videoCodec: typeof video?.codec_name === "string" ? video.codec_name : undefined, audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : undefined, hasAudio: Boolean(audio) };
}

export async function convertToMp4(inputPath: string, outputPath: string): Promise<void> {
  await runProcess(binary("ffmpeg"), ["-y", "-i", inputPath, "-vf", "tpad=stop_mode=clone:stop_duration=5", "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", outputPath]);
}

export async function stripAudio(inputPath: string, outputPath: string): Promise<void> {
  await runProcess(binary("ffmpeg"), ["-y", "-i", inputPath, "-map", "0:v:0", "-c:v", "copy", "-an", outputPath]);
}

export async function inspectVideoFilter(filePath: string, filter: string, marker: RegExp): Promise<FilterProbe> {
  try {
    const result = await runProcess(binary("ffmpeg"), ["-hide_banner", "-i", filePath, "-vf", filter, "-an", "-f", "null", "-"]);
    const output = `${result.stdout}\n${result.stderr}`;
    return { detected: marker.test(output), output };
  } catch (error) {
    return { detected: false, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function mixWavSegments(segments: Array<{ path: string; startMs: number }>, outputPath: string): Promise<void> {
  if (segments.length === 0) throw new Error("Cannot mix an empty audio segment list");
  if (segments.length === 1 && segments[0]!.startMs === 0) {
    await runProcess(binary("ffmpeg"), ["-y", "-i", segments[0]!.path, "-c:a", "pcm_s16le", outputPath]);
    return;
  }
  const args = ["-y"];
  for (const segment of segments) args.push("-i", segment.path);
  const filters = segments.map((segment, index) => `[${index}:a]adelay=${Math.max(0, Math.round(segment.startMs))}|${Math.max(0, Math.round(segment.startMs))}[a${index}]`);
  filters.push(`${segments.map((_, index) => `[a${index}]`).join("")}amix=inputs=${segments.length}:duration=longest:normalize=0[aout]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[aout]", "-c:a", "pcm_s16le", outputPath);
  await runProcess(binary("ffmpeg"), args);
}

export async function fileSize(filePath: string): Promise<number> {
  return (await stat(filePath)).size;
}
