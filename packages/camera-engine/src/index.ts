import type { AudioTimeline, BoundingBox, CameraKeyframe, CameraPose, CameraTrack, CaptureEvent, LocatedTarget } from "../../../packages/shared/src/types.js";

export const BASE_POSE: CameraPose = { scale: 1, cx: 0.5, cy: 0.48 };
export const MIN_SCALE = 1.18;
export const MAX_SCALE = 2.8;
export const MAX_PAN_PX = 500;

export interface CameraOptions {
  desiredScale?: number;
  maxScale?: number;
  padding?: number;
  viewport?: { width: number; height: number };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function easeInOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function poseTravelPx(from: CameraPose, to: CameraPose, viewport: { width: number; height: number }): number {
  return Math.hypot((to.cx - from.cx) * viewport.width, (to.cy - from.cy) * viewport.height);
}

export function fitTarget(target: LocatedTarget | BoundingBox, options: CameraOptions = {}): CameraPose {
  const viewport = options.viewport ?? {
    width: "viewportWidth" in target ? target.viewportWidth : 1440,
    height: "viewportHeight" in target ? target.viewportHeight : 1080,
  };
  const box = "boundingBox" in target ? target.boundingBox : target;
  const padding = options.padding ?? 48;
  const desired = options.desiredScale ?? 1.55;
  const maxScale = options.maxScale ?? MAX_SCALE;
  const fitScale = Math.min(viewport.width / Math.max(1, box.width + padding * 2), viewport.height / Math.max(1, box.height + padding * 2));
  const upperScale = Math.min(desired, fitScale, maxScale, MAX_SCALE);
  const scale = upperScale < MIN_SCALE ? clamp(upperScale, 0.5, MAX_SCALE) : clamp(upperScale, MIN_SCALE, MAX_SCALE);
  const rawCx = (box.x + box.width / 2) / viewport.width;
  const rawCy = (box.y + box.height / 2) / viewport.height;
  const half = 1 / (2 * scale);
  return { scale, cx: clamp(rawCx, half, 1 - half), cy: clamp(rawCy, half, 1 - half) };
}

export function targetInsideSafeArea(target: BoundingBox, pose: CameraPose, viewport: { width: number; height: number }, safePx = 48): boolean {
  const left = (target.x - pose.cx * viewport.width) * pose.scale + viewport.width / 2;
  const right = (target.x + target.width - pose.cx * viewport.width) * pose.scale + viewport.width / 2;
  const top = (target.y - pose.cy * viewport.height) * pose.scale + viewport.height / 2;
  const bottom = (target.y + target.height - pose.cy * viewport.height) * pose.scale + viewport.height / 2;
  return left >= safePx && right <= viewport.width - safePx && top >= safePx && bottom <= viewport.height - safePx;
}

export function interpolatePose(from: CameraPose, to: CameraPose, progress: number): CameraPose {
  const eased = easeInOutCubic(progress);
  return { scale: mix(from.scale, to.scale, eased), cx: mix(from.cx, to.cx, eased), cy: mix(from.cy, to.cy, eased) };
}

export function poseToCss(pose: CameraPose, fit = 1): { scale: number; translateX: number; translateY: number } {
  const scale = fit * pose.scale;
  return { scale, translateX: fit * (0.5 - pose.scale * pose.cx), translateY: fit * (0.5 - pose.scale * pose.cy) };
}

export function zoomTo(from: CameraPose, target: LocatedTarget | BoundingBox, startMs: number, endMs: number, options: CameraOptions = {}, rotation = 0): CameraKeyframe[] {
  const pose = fitTarget(target, options);
  return [{ timeMs: startMs, pose: from, rotation }, { timeMs: Math.max(startMs, endMs), pose, rotation }];
}

export function panTo(from: CameraPose, target: CameraPose, startMs: number, endMs: number, rotation = 0): CameraKeyframe[] {
  return [{ timeMs: startMs, pose: from, rotation }, { timeMs: Math.max(startMs, endMs), pose: target, rotation }];
}

export function zoomOut(from: CameraPose, startMs: number, endMs: number, rotation = 0): CameraKeyframe[] {
  return [{ timeMs: startMs, pose: from, rotation }, { timeMs: Math.max(startMs, endMs), pose: BASE_POSE, rotation: 0 }];
}

function normalizeKeys(keys: CameraKeyframe[]): CameraKeyframe[] {
  const sorted = [...keys].sort((a, b) => a.timeMs - b.timeMs);
  const output: CameraKeyframe[] = [];
  for (const key of sorted) {
    const previous = output[output.length - 1];
    if (previous && key.timeMs === previous.timeMs) output[output.length - 1] = key;
    else output.push(key);
  }
  return output;
}

export function sampleCameraTrack(track: CameraTrack, timeMs: number): CameraKeyframe {
  const keys = track.frames;
  if (keys.length === 0) return { timeMs, pose: BASE_POSE, rotation: 0 };
  if (timeMs <= keys[0]!.timeMs) return keys[0]!;
  for (let index = 1; index < keys.length; index += 1) {
    const next = keys[index]!;
    const previous = keys[index - 1]!;
    if (timeMs <= next.timeMs) {
      const span = Math.max(1, next.timeMs - previous.timeMs);
      return { timeMs, pose: interpolatePose(previous.pose, next.pose, (timeMs - previous.timeMs) / span), rotation: mix(previous.rotation, next.rotation, easeInOutCubic((timeMs - previous.timeMs) / span)) };
    }
  }
  return keys[keys.length - 1]!;
}

function segmentFor(lineId: string, timeline: AudioTimeline): { startMs: number; endMs: number } | undefined {
  const segment = timeline.segments.find((item) => item.lineId === lineId);
  return segment ? { startMs: segment.startMs, endMs: segment.endMs } : undefined;
}

export function followTargets(events: CaptureEvent[], audioTimeline: AudioTimeline, options: { viewport?: { width: number; height: number }; defaultRotation?: number } = {}): CameraTrack {
  const viewport = options.viewport ?? { width: 1440, height: 1080 };
  const durationMs = Math.max(audioTimeline.totalDurationMs, 12000);
  const ordered = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  const frames: CameraKeyframe[] = [{ timeMs: 0, pose: BASE_POSE, rotation: 0 }];
  let current = BASE_POSE;
  let currentRotation = 0;
  let currentEnd = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]!;
    const segment = segmentFor(event.lineId, audioTimeline);
    if (!segment) continue;
    const next = fitTarget(event, { desiredScale: event.target.kind === "stars" ? 2.25 : index === 0 ? 1.55 : 1.65, padding: event.target.kind === "stars" ? 30 : 52, viewport });
    const start = segment.startMs;
    const end = index === ordered.length - 1 ? durationMs : Math.min(durationMs, Math.max(start + 900, segment.endMs));
    const transition = Math.min(650, Math.max(450, Math.floor(Math.max(1, end - start) * 0.28)));
    const rotation = options.defaultRotation ?? 0;
    const distance = poseTravelPx(current, next, viewport);
    if (index === 0) {
      frames.push({ timeMs: start, pose: current, rotation: currentRotation });
      frames.push({ timeMs: Math.min(end, start + transition), pose: next, rotation });
    } else if (distance > MAX_PAN_PX) {
      const available = Math.max(0, start - currentEnd);
      const outDuration = Math.min(520, Math.max(260, Math.floor(available * 0.45)));
      const inDuration = Math.min(620, Math.max(300, Math.floor(available * 0.55)));
      const chainStart = Math.max(currentEnd, start - outDuration - inDuration);
      const outEnd = Math.min(start, chainStart + outDuration);
      const inStart = Math.min(start, outEnd);
      frames.push(...zoomOut(current, chainStart, outEnd, currentRotation));
      frames.push(...zoomTo(BASE_POSE, event, inStart, start, { desiredScale: next.scale, padding: 0, viewport }, rotation));
    } else {
      const panStart = Math.max(currentEnd, start - Math.min(700, Math.max(400, transition)));
      const panEnd = Math.min(end, Math.max(start, panStart + transition));
      frames.push(...panTo(current, next, panStart, panEnd, rotation));
    }
    frames.push({ timeMs: Math.min(durationMs, Math.max(start + transition, end - 1)), pose: next, rotation });
    current = next;
    currentRotation = rotation;
    currentEnd = end;
  }
  if (currentEnd < durationMs - 420 && ordered.length > 0) frames.push(...zoomOut(current, durationMs - 420, durationMs));
  return { durationMs, frames: normalizeKeys(frames) };
}
