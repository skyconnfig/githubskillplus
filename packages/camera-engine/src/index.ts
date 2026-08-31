import type { AudioTimeline, BoundingBox, CameraEasing, CameraKeyframe, CameraPose, CameraTrack, CaptureEvent, PointerSample, StoryboardScene } from "../../../packages/shared/src/types.js";

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

export interface CameraPlannerOptions {
  viewport?: { width: number; height: number };
  maxScale?: number;
  minReadableScale?: number;
  cursorFollowThreshold?: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function easeInOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function ease(value: number, easing: CameraEasing = "ease-in-out"): number {
  const t = clamp(value, 0, 1);
  if (easing === "linear") return t;
  if (easing === "ease-in") return t * t * t;
  if (easing === "ease-out") return 1 - Math.pow(1 - t, 3);
  if (easing === "spring") return 1 - Math.cos(t * Math.PI * 0.5) * Math.exp(-4 * t);
  return easeInOutCubic(t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function poseTravelPx(from: CameraPose, to: CameraPose, viewport: { width: number; height: number }): number {
  return Math.hypot((to.cx - from.cx) * viewport.width, (to.cy - from.cy) * viewport.height);
}

export function fitTarget(target: { boundingBox: BoundingBox; viewportWidth: number; viewportHeight: number } | BoundingBox, options: CameraOptions = {}): CameraPose {
  const viewport = options.viewport ?? ("boundingBox" in target ? { width: target.viewportWidth, height: target.viewportHeight } : { width: 1440, height: 1080 });
  const box = "boundingBox" in target ? target.boundingBox : target;
  const padding = options.padding ?? 48;
  const desired = options.desiredScale ?? 1.55;
  const maxScale = Math.min(options.maxScale ?? MAX_SCALE, MAX_SCALE);
  const fitScale = Math.min(viewport.width / Math.max(1, box.width + padding * 2), viewport.height / Math.max(1, box.height + padding * 2));
  const upperScale = Math.min(desired, fitScale, maxScale);
  const scale = upperScale < MIN_SCALE ? clamp(upperScale, 0.5, maxScale) : clamp(upperScale, MIN_SCALE, maxScale);
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

export function interpolatePose(from: CameraPose, to: CameraPose, progress: number, easing: CameraEasing = "ease-in-out"): CameraPose {
  const eased = ease(progress, easing);
  return { scale: mix(from.scale, to.scale, eased), cx: mix(from.cx, to.cx, eased), cy: mix(from.cy, to.cy, eased) };
}

export function poseToCss(pose: CameraPose, fit = 1): { scale: number; translateX: number; translateY: number } {
  const scale = fit * pose.scale;
  return { scale, translateX: fit * (0.5 - pose.scale * pose.cx), translateY: fit * (0.5 - pose.scale * pose.cy) };
}

export function zoomTo(from: CameraPose, target: { boundingBox: BoundingBox; viewportWidth: number; viewportHeight: number } | BoundingBox, startMs: number, endMs: number, options: CameraOptions = {}, rotation = 0, easing: CameraEasing = "ease-in-out"): CameraKeyframe[] {
  const pose = fitTarget(target, options);
  return [{ timeMs: startMs, pose: from, rotation, easing }, { timeMs: Math.max(startMs, endMs), pose, rotation, easing }];
}

export function panTo(from: CameraPose, target: CameraPose, startMs: number, endMs: number, rotation = 0, easing: CameraEasing = "ease-in-out"): CameraKeyframe[] {
  return [{ timeMs: startMs, pose: from, rotation, easing }, { timeMs: Math.max(startMs, endMs), pose: target, rotation, easing }];
}

export function zoomOut(from: CameraPose, startMs: number, endMs: number, rotation = 0, easing: CameraEasing = "ease-in-out"): CameraKeyframe[] {
  return [{ timeMs: startMs, pose: from, rotation, easing }, { timeMs: Math.max(startMs, endMs), pose: BASE_POSE, rotation: 0, easing }];
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
      const progress = (timeMs - previous.timeMs) / span;
      const easing = previous.easing ?? "ease-in-out";
      return { timeMs, pose: interpolatePose(previous.pose, next.pose, progress, easing), rotation: mix(previous.rotation, next.rotation, ease(progress, easing)), easing };
    }
  }
  return keys[keys.length - 1]!;
}

function segmentFor(lineId: string, timeline: AudioTimeline): { startMs: number; endMs: number } | undefined {
  const segment = timeline.segments.find((item) => item.lineId === lineId);
  return segment ? { startMs: segment.startMs, endMs: segment.endMs } : undefined;
}

function cursorAt(samples: PointerSample[], timeMs: number): { x: number; y: number } | undefined {
  if (samples.length === 0) return undefined;
  const ordered = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const next = ordered.find((sample) => sample.timeMs >= timeMs) ?? ordered[ordered.length - 1];
  const previous = [...ordered].reverse().find((sample) => sample.timeMs <= timeMs) ?? ordered[0];
  if (!next || !previous) return undefined;
  const span = Math.max(1, next.timeMs - previous.timeMs);
  const progress = clamp((timeMs - previous.timeMs) / span, 0, 1);
  return { x: mix(previous.x, next.x, progress), y: mix(previous.y, next.y, progress) };
}

function pointPose(point: { x: number; y: number }, viewport: { width: number; height: number }, desiredScale: number): CameraPose {
  const half = 1 / (2 * desiredScale);
  return { scale: desiredScale, cx: clamp(point.x / viewport.width, half, 1 - half), cy: clamp(point.y / viewport.height, half, 1 - half) };
}

function poseForScene(scene: StoryboardScene, event: CaptureEvent, current: CameraPose, viewport: { width: number; height: number }, options: CameraPlannerOptions): CameraPose {
  const intent = scene.camera;
  if (intent.mode === "static") return current;
  if (intent.mode === "zoom-out") return BASE_POSE;
  if (intent.mode === "follow-cursor") {
    const point = cursorAt(event.cursorTrack, intent.followDelayMs ?? 120);
    if (!point || Math.hypot(point.x - viewport.width / 2, point.y - viewport.height / 2) < (options.cursorFollowThreshold ?? 0.25) * Math.min(viewport.width, viewport.height)) return current;
    return pointPose(point, viewport, clamp(intent.desiredScale, options.minReadableScale ?? MIN_SCALE, options.maxScale ?? MAX_SCALE));
  }
  return fitTarget(event, { desiredScale: intent.desiredScale, padding: intent.padding, viewport, maxScale: options.maxScale });
}

export function planCameraTrack(events: CaptureEvent[], scenes: StoryboardScene[], audioTimeline: AudioTimeline, options: CameraPlannerOptions = {}): CameraTrack {
  const viewport = options.viewport ?? { width: 1440, height: 1080 };
  const durationMs = Math.max(audioTimeline.totalDurationMs, ...scenes.map((scene) => scene.endMs), 1);
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const ordered = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  const frames: CameraKeyframe[] = [{ timeMs: 0, pose: BASE_POSE, rotation: 0, easing: "ease-in-out" }];
  let current = BASE_POSE;
  let currentRotation = 0;
  let currentEnd = 0;
  for (const [index, event] of ordered.entries()) {
    const scene = sceneById.get(event.sceneId);
    const segment = segmentFor(event.lineId, audioTimeline);
    if (!scene || !segment) continue;
    const intent = scene.camera;
    const start = segment.startMs;
    const end = Math.min(durationMs, Math.max(start + 1, segment.endMs));
    const easing = intent.easing ?? "ease-in-out";
    const transition = Math.min(Math.max(0, intent.transitionMs), Math.max(0, end - start));
    const next = poseForScene(scene, event, current, viewport, options);
    const rotation = intent.rotation;
    const distance = poseTravelPx(current, next, viewport);
    if (index === 0) {
      // The opening shot starts on its target. Later shots move during their own window.
      frames.push({ timeMs: start, pose: next, rotation, easing });
    } else if (intent.mode === "zoom-out") {
      const moveEnd = Math.min(end, start + transition);
      frames.push(...zoomOut(current, start, moveEnd, currentRotation, easing));
    } else if (intent.mode !== "static" && distance > MAX_PAN_PX) {
      const available = Math.max(0, end - start);
      const outDuration = Math.min(520, Math.max(260, Math.floor(available * 0.13)));
      const panDuration = Math.min(460, Math.max(220, Math.floor(available * 0.11)));
      const inDuration = Math.min(620, Math.max(300, Math.floor(available * 0.16)));
      const chainEnd = start + outDuration + panDuration + inDuration;
      if (chainEnd <= end) {
        const outEnd = start + outDuration;
        const panEnd = outEnd + panDuration;
        const baseAtTarget = { ...BASE_POSE, cx: next.cx, cy: next.cy };
        frames.push(...zoomOut(current, start, outEnd, currentRotation, easing));
        frames.push(...panTo(BASE_POSE, baseAtTarget, outEnd, panEnd, 0, easing));
        frames.push(...panTo(baseAtTarget, next, panEnd, chainEnd, rotation, easing));
      } else {
        frames.push({ timeMs: start, pose: current, rotation: currentRotation, easing });
        frames.push({ timeMs: Math.min(end, start + transition), pose: next, rotation, easing });
      }
    } else if (intent.mode !== "static") {
      const moveEnd = Math.min(end, start + transition);
      frames.push({ timeMs: start, pose: current, rotation: currentRotation, easing });
      frames.push({ timeMs: Math.max(start, moveEnd), pose: next, rotation, easing });
    }
    frames.push({ timeMs: Math.min(durationMs, end), pose: next, rotation, easing });
    current = next;
    currentRotation = rotation;
    currentEnd = end;
  }
  return { durationMs, frames: normalizeKeys(frames) };
}

export const buildCameraTrack = planCameraTrack;
