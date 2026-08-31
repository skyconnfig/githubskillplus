import { createHash } from "node:crypto";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioTimeline, ScriptDocument } from "../../../packages/shared/src/types.js";
import { mixWavSegments, probeMedia } from "../../../packages/ffmpeg-utils/src/index.js";

export interface TtsClientOptions {
  baseUrl?: string;
  voicePath: string;
  lang?: "zh" | "en";
  cacheDir: string;
}

interface BridgeResponse {
  audioBase64: string;
  durationMs: number;
  sampleRate: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

async function voiceFingerprint(voicePath: string): Promise<string> {
  const metadata = await stat(voicePath);
  return hash(JSON.stringify({ path: voicePath, size: metadata.size, modifiedMs: metadata.mtimeMs }));
}

export async function checkTtsBridge(baseUrl = "http://127.0.0.1:8125"): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function synthesizeLine(text: string, options: TtsClientOptions): Promise<{ path: string; durationMs: number }> {
  await mkdir(options.cacheDir, { recursive: true });
  const voiceHash = await voiceFingerprint(options.voicePath);
  const key = hash(JSON.stringify({ text, voiceHash, lang: options.lang ?? "zh", baseUrl: options.baseUrl ?? "http://127.0.0.1:8125" }));
  const path = join(options.cacheDir, `${key}.wav`);
  try {
    const probe = await probeMedia(path);
    if (probe.durationMs > 0) return { path, durationMs: probe.durationMs };
  } catch {
    // Cache miss.
  }
  const response = await fetch(`${options.baseUrl ?? "http://127.0.0.1:8125"}/v1/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voicePath: options.voicePath, lang: options.lang ?? "zh" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`IndexTTS Bridge failed (${response.status}): ${detail.slice(-1200)}`);
  }
  const payload = (await response.json()) as BridgeResponse;
  if (!payload.audioBase64 || !Number.isFinite(payload.durationMs)) throw new Error("IndexTTS Bridge returned invalid audio metadata");
  await writeFile(path, Buffer.from(payload.audioBase64, "base64"));
  return { path, durationMs: payload.durationMs };
}

export async function buildAudioTimeline(script: ScriptDocument, options: TtsClientOptions, outputDir: string): Promise<AudioTimeline> {
  await mkdir(outputDir, { recursive: true });
  const segments: AudioTimeline["segments"] = [];
  const files: Array<{ path: string; startMs: number }> = [];
  let cursor = 0;
  for (const line of script.lines) {
    const result = await synthesizeLine(line.text, options);
    const outputPath = join(outputDir, `${line.id}.wav`);
    await writeFile(outputPath, await (await import("node:fs/promises")).readFile(result.path));
    const measured = await probeMedia(outputPath);
    segments.push({ lineId: line.id, text: line.text, audioPath: outputPath, startMs: cursor, durationMs: measured.durationMs, endMs: cursor + measured.durationMs });
    files.push({ path: outputPath, startMs: cursor });
    cursor += measured.durationMs;
  }
  const mixedPath = join(outputDir, "narration.wav");
  await mixWavSegments(files, mixedPath);
  return { schemaVersion: 1, audioPath: mixedPath, totalDurationMs: cursor, segments };
}

export async function assertVoiceExists(voicePath: string): Promise<void> {
  try { await access(voicePath); } catch { throw new Error(`IndexTTS voice file not found: ${voicePath}`); }
}
