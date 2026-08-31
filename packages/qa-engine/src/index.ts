import type { CameraTrack, DirectorPlan, PointerSample, QualityReport, StoryboardDocument, TargetTrack } from "../../../packages/shared/src/types.js";

export type QaStatus = "pass" | "warn" | "fail";
export interface QaCheck { name: string; status: QaStatus; message: string }

export function buildDirectorQualityChecks(plan: DirectorPlan): QaCheck[] {
  const checks: QaCheck[] = [];
  const zoomCounts = plan.beats.map((beat) => beat.actions.filter((action) => action.type === "camera-zoom").length > 0);
  const runs = zoomCounts.join("|").match(/true\|true\|true/g)?.length ?? 0;
  checks.push({ name: "zoom-fatigue", status: runs > 0 ? "warn" : "pass", message: runs > 0 ? "three or more consecutive beats zoom" : "zoom rhythm is varied" });
  const zoomStarts = plan.beats.filter((beat) => beat.actions.some((action) => action.type === "camera-zoom")).map((beat) => beat.startMs);
  const dense = zoomStarts.some((start, index) => zoomStarts.slice(index + 1).filter((other) => other - start <= 10000).length >= 5);
  checks.push({ name: "zoom-frequency", status: dense ? "warn" : "pass", message: dense ? "more than five zooms occur in a ten-second window" : "zoom frequency is bounded" });
  const missingStrongAnnotation = plan.beats.some((beat) => beat.importance === 3 && !beat.actions.some((action) => action.type === "annotation"));
  checks.push({ name: "important-annotation", status: missingStrongAnnotation ? "fail" : "pass", message: missingStrongAnnotation ? "an importance-3 beat has no annotation" : "importance-3 beats have annotations" });
  const shortHold = plan.beats.some((beat) => beat.importance === 3 && !beat.actions.some((action) => action.type === "hold" && action.durationMs >= 700));
  checks.push({ name: "important-dwell", status: shortHold ? "fail" : "pass", message: shortHold ? "an importance-3 beat holds for less than 700ms" : "importance-3 beats have readable dwell" });
  return checks;
}

export function buildTrackQualityChecks(track: CameraTrack, targets: TargetTrack[], pointers: PointerSample[], viewport: { width: number; height: number }): QaCheck[] {
  const checks: QaCheck[] = [];
  const overzoom = track.frames.some((frame) => frame.pose.scale > 2.8);
  checks.push({ name: "camera-overzoom", status: overzoom ? "fail" : "pass", message: overzoom ? "camera scale exceeds 2.8" : "camera scale is within 2.8" });
  const outside = track.frames.some((frame) => frame.pose.cx < 0 || frame.pose.cx > 1 || frame.pose.cy < 0 || frame.pose.cy > 1);
  checks.push({ name: "camera-bounds", status: outside ? "fail" : "pass", message: outside ? "camera center is outside normalized bounds" : "camera centers are bounded" });
  const cursorOutside = pointers.some((sample) => sample.x < 0 || sample.y < 0 || sample.x > viewport.width || sample.y > viewport.height);
  checks.push({ name: "cursor-outside-frame", status: cursorOutside ? "warn" : "pass", message: cursorOutside ? "pointer samples leave the capture viewport" : "pointer samples stay in the capture viewport" });
  const invisible = targets.some((target) => target.samples.length === 0 || target.samples.every((sample) => !sample.visible));
  checks.push({ name: "target-not-visible", status: invisible ? "fail" : "pass", message: invisible ? "a target has no visible sample" : "all targets have visible samples" });
  const tooFastScroll = targets.length > 0 && targets.some((target) => target.samples.slice(1).some((sample, index) => Math.abs(sample.y - target.samples[index]!.y) > viewport.height * 0.8));
  checks.push({ name: "scroll-too-fast", status: tooFastScroll ? "warn" : "pass", message: tooFastScroll ? "target position changes by more than 80% viewport per sample" : "scroll movement is bounded" });
  return checks;
}

export function summarizeQuality(checks: QaCheck[]): QualityReport {
  const status = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass";
  return { status, checks };
}

export function storyboardQualityChecks(storyboard: StoryboardDocument): QaCheck[] {
  const duplicate = new Set(storyboard.scenes.map((scene) => scene.id)).size !== storyboard.scenes.length;
  const blank = storyboard.scenes.some((scene) => scene.narration.trim().length === 0 || scene.endMs <= scene.startMs);
  return [
    { name: "duplicate-scene", status: duplicate ? "fail" : "pass", message: duplicate ? "duplicate scene ids detected" : "scene ids are unique" },
    { name: "blank-scene", status: blank ? "fail" : "pass", message: blank ? "a scene is blank or has invalid timing" : "all scenes have narration and timing" },
  ];
}
