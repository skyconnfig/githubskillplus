import { describe, expect, it } from "vitest";
import { BASE_POSE, MAX_SCALE, fitTarget, planCameraTrack, poseToCss, sampleCameraTrack, targetInsideSafeArea } from "../packages/camera-engine/src/index.js";
import type { CameraTrack, CaptureEvent } from "../packages/shared/src/types.js";

describe("camera engine", () => {
  it("fits a target inside normalized camera bounds", () => {
    const pose = fitTarget({ x: 1300, y: 900, width: 80, height: 40 }, { desiredScale: 2.4, viewport: { width: 1440, height: 1080 } });
    expect(pose.scale).toBeLessThanOrEqual(MAX_SCALE);
    expect(pose.cx).toBeGreaterThanOrEqual(1 / (2 * pose.scale));
    expect(pose.cx).toBeLessThanOrEqual(1 - 1 / (2 * pose.scale));
    expect(pose.cy).toBeGreaterThanOrEqual(1 / (2 * pose.scale));
  });

  it("uses a continuous translate form at base scale", () => {
    expect(poseToCss(BASE_POSE)).toEqual({ scale: 1, translateX: 0, translateY: 0.020000000000000018 });
  });

  it("centers a zoomed content-space target after the page fit", () => {
    const css = poseToCss({ scale: 2, cx: 0.25, cy: 0.25 }, 0.86);
    expect(css.scale).toBeCloseTo(1.72);
    expect(css.translateX).toBeCloseTo(0);
    expect(css.translateY).toBeCloseTo(0);
  });

  it("samples eased camera keyframes", () => {
    const track: CameraTrack = { durationMs: 1000, frames: [{ timeMs: 0, pose: BASE_POSE, rotation: 0 }, { timeMs: 1000, pose: { scale: 2, cx: 0.25, cy: 0.25 }, rotation: 1 }] };
    const middle = sampleCameraTrack(track, 500);
    expect(middle.pose.scale).toBeGreaterThan(1);
    expect(middle.pose.scale).toBeLessThan(2);
    expect(middle.rotation).toBeGreaterThan(0);
  });

  it("keeps a fitted target inside the safe area", () => {
    const target = { x: 120, y: 180, width: 220, height: 80 };
    const pose = fitTarget(target, { desiredScale: 1.55, viewport: { width: 1440, height: 1080 } });
    expect(targetInsideSafeArea(target, pose, { width: 1440, height: 1080 }, 24)).toBe(true);
  });

  it("builds a bounded zoom chain for distant targets", () => {
    const event = (lineId: string, x: number, y: number, timestampMs: number): CaptureEvent => ({
      target: { kind: "readme-text", text: lineId },
      selector: "p",
      text: lineId,
      boundingBox: { x, y, width: 140, height: 50 },
      viewportWidth: 1440,
      viewportHeight: 1080,
      scrollY: 0,
      pageUrl: "https://github.com/example/repo",
      sceneId: lineId,
      lineId,
      targetId: `target-${lineId}`,
      timestampMs,
      durationMs: 4000,
      cursorTrack: [],
    });
    const scenes = [
      { id: "line-01", lineId: "line-01", narration: "one", source: { type: "github" as const, url: "https://github.com/example/repo", target: { kind: "readme-text" as const, text: "line-01" } }, startMs: 0, endMs: 4000, beatType: "establish" as const, targetId: "target-line-01", camera: { mode: "zoom-in" as const, desiredScale: 1.5, rotation: 0, transitionMs: 500, padding: 40 }, annotations: [] },
      { id: "line-02", lineId: "line-02", narration: "two", source: { type: "github" as const, url: "https://github.com/example/repo", target: { kind: "readme-text" as const, text: "line-02" } }, startMs: 5000, endMs: 9000, beatType: "proof" as const, targetId: "target-line-02", camera: { mode: "zoom-in" as const, desiredScale: 2, rotation: 0, transitionMs: 500, padding: 30 }, annotations: [] },
    ];
    const track = planCameraTrack([event("line-01", 80, 80, 0), event("line-02", 1260, 900, 5000)], scenes, {
      schemaVersion: 1,
      audioPath: "voice.wav",
      totalDurationMs: 9000,
      segments: [
        { lineId: "line-01", text: "one", audioPath: "one.wav", startMs: 0, durationMs: 4000, endMs: 4000 },
        { lineId: "line-02", text: "two", audioPath: "two.wav", startMs: 5000, durationMs: 4000, endMs: 9000 },
      ],
    });
    expect(track.frames.length).toBeGreaterThan(3);
    expect(Math.max(...track.frames.map((frame) => frame.pose.scale))).toBeLessThanOrEqual(MAX_SCALE);
    expect(track.frames.some((frame) => frame.pose.scale === BASE_POSE.scale)).toBe(true);
  });
});
