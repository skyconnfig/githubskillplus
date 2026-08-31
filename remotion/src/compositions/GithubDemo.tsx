import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { createAnnotationGeometry } from "../../../packages/annotation-engine/src/index.js";
import { poseToCss, sampleCameraTrack } from "../../../packages/camera-engine/src/index.js";
import { wrapCaption } from "../../../packages/subtitle-engine/src/index.js";
import type { AnnotationType, BoundingBox, CameraTrack, CaptureEvent, PointerSample, StoryboardDocument, TargetTrack, WordTimeline } from "../../../packages/shared/src/types.js";

export interface GithubDemoProps {
  captureVideo: string;
  narrationAudio: string;
  captureStartMs: number;
  cameraTrack: CameraTrack;
  captureEvents: CaptureEvent[];
  storyboard: Pick<StoryboardDocument, "scenes">;
  subtitles: Array<{ startMs: number; endMs: number; text: string; keyword?: string }>;
  wordTimeline?: WordTimeline;
  targetTracks?: TargetTrack[];
  pointerTrack?: PointerSample[];
  showAnnotations: boolean;
  showCursor: boolean;
  showSubtitles: boolean;
  includeAudio: boolean;
}

const pink = "#FF00DC";

function activeEvent(props: GithubDemoProps, timeMs: number): CaptureEvent | undefined {
  return props.captureEvents.find((event) => timeMs >= event.timestampMs && timeMs < event.timestampMs + event.durationMs);
}

function targetBoxAt(props: GithubDemoProps, event: CaptureEvent, timeMs: number): BoundingBox {
  const track = props.targetTracks?.find((item) => item.targetId === event.targetId);
  if (!track || track.samples.length === 0) return event.boundingBox;
  const next = track.samples.find((sample) => sample.timeMs >= timeMs) ?? track.samples[track.samples.length - 1]!;
  const previous = [...track.samples].reverse().find((sample) => sample.timeMs <= timeMs) ?? track.samples[0]!;
  const span = Math.max(1, next.timeMs - previous.timeMs);
  const progress = Math.max(0, Math.min(1, (timeMs - previous.timeMs) / span));
  return { x: previous.x + (next.x - previous.x) * progress, y: previous.y + (next.y - previous.y) * progress, width: previous.width + (next.width - previous.width) * progress, height: previous.height + (next.height - previous.height) * progress };
}

function annotationProgress(annotation: { startMs: number; enterMs: number; holdMs: number; exitMs: number }, localMs: number): number {
  if (localMs < annotation.startMs) return 0;
  const active = localMs - annotation.startMs;
  const enter = Math.max(1, annotation.enterMs);
  const hold = Math.max(0, annotation.holdMs);
  const exit = Math.max(1, annotation.exitMs);
  if (active < enter) return active / enter;
  if (active < enter + hold) return 1;
  if (active < enter + hold + exit) return 1 - (active - enter - hold) / exit;
  return 0;
}

function AnnotationLayer({ props, timeMs, box }: { props: GithubDemoProps; timeMs: number; box: BoundingBox }): React.ReactElement {
  const event = props.showAnnotations || props.showCursor ? activeEvent(props, timeMs) : undefined;
  const scene = event ? props.storyboard.scenes.find((item) => item.id === event.sceneId) : undefined;
  if (!event || !scene) return <></>;
  const localMs = timeMs - event.timestampMs;
  const pathAnnotations = scene.annotations.filter((annotation) => annotation.type === "hand-circle" || annotation.type === "hand-underline" || annotation.type === "hand-box" || annotation.type === "arrow" || annotation.type === "focus-ring" || annotation.type === "bracket" || annotation.type === "callout" || annotation.type === "number-badge");
  const maskId = `spotlight-${scene.id}`;
  const spotlight = scene.annotations.find((annotation) => annotation.type === "spotlight");
  const selection = scene.annotations.find((annotation) => annotation.type === "text-selection");
  const highlight = scene.annotations.find((annotation) => annotation.type === "highlight");
  return (
    <svg width="1440" height="1080" viewBox="0 0 1440 1080" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
      {spotlight && (
        <>
          <defs>
            <mask id={maskId}>
              <rect width="1440" height="1080" fill="white" />
              <rect x={box.x - 10} y={box.y - 10} width={box.width + 20} height={box.height + 20} rx="12" fill="black" />
            </mask>
          </defs>
          <rect width="1440" height="1080" fill="rgba(0,0,0,.42)" mask={`url(#${maskId})`} opacity={annotationProgress(spotlight, localMs)} />
        </>
      )}
      {selection && <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="3" fill="rgba(59,130,246,.48)" opacity={annotationProgress(selection, localMs)} />}
      {highlight && <rect x={box.x - 6} y={box.y - 4} width={box.width + 12} height={box.height + 8} rx="5" fill="rgba(255,216,0,.38)" opacity={annotationProgress(highlight, localMs)} />}
      {pathAnnotations.map((annotation) => {
        const progress = annotationProgress(annotation, localMs);
        const geometry = createAnnotationGeometry(annotation.type, box, annotation.id);
        return geometry.path ? <path key={annotation.id} d={geometry.path} fill="none" stroke={annotation.color || pink} strokeWidth={annotation.strokeWidth || 10} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - progress} opacity={progress} /> : null;
      })}
    </svg>
  );
}

function Cursor({ event, timeMs }: { event: CaptureEvent | undefined; timeMs: number }): React.ReactElement {
  const track = event?.cursorTrack ?? [];
  const localMs = event ? timeMs - event.timestampMs : 0;
  const first = track[0] ?? { timeMs: 0, x: 720, y: 540, event: "idle" as const };
  const last = track[track.length - 1] ?? first;
  const next = track.find((point) => point.timeMs >= localMs) ?? last;
  const previous = track.slice().reverse().find((point) => point.timeMs <= localMs) ?? first;
  const span = Math.max(1, next.timeMs - previous.timeMs);
  const progress = Math.max(0, Math.min(1, (localMs - previous.timeMs) / span));
  const x = previous.x + (next.x - previous.x) * progress;
  const y = previous.y + (next.y - previous.y) * progress;
  const click = next.event === "click" || next.event === "down";
  return <div style={{ position: "absolute", left: x, top: y, width: click ? 32 : 24, height: click ? 32 : 24, borderRadius: "50%", border: "3px solid white", background: "rgba(255,0,220,.72)", boxShadow: "0 0 0 5px rgba(255,0,220,.24), 0 0 18px rgba(255,0,220,.8)", transform: "translate(-50%,-50%)", pointerEvents: "none", opacity: event && timeMs >= event.timestampMs ? 1 : 0 }} />;
}

function KeywordCaption({ text, keyword }: { text: string; keyword?: string }): React.ReactElement {
  if (!keyword || !text.includes(keyword)) return <>{text}</>;
  const parts = text.split(keyword);
  return <>{parts.map((part, index) => <React.Fragment key={`${part}-${index}`}>{index > 0 && <span style={{ color: "#FFD800" }}>{keyword}</span>}{part}</React.Fragment>)}</>;
}

function Subtitle({ props, timeMs }: { props: GithubDemoProps; timeMs: number }): React.ReactElement {
  const caption = props.subtitles.find((item) => timeMs >= item.startMs && timeMs < item.endMs);
  const lines = caption ? wrapCaption(caption.text).split("\n") : [];
  return <div style={{ position: "absolute", left: "7%", right: "7%", bottom: "5.5%", minHeight: "8%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#FFFFFF", fontFamily: "Microsoft YaHei, Arial, sans-serif", fontWeight: 900, fontSize: "clamp(42px, 3.5vw, 56px)", lineHeight: 1.25, whiteSpace: "pre-line", WebkitTextStroke: "5px #090d17", paintOrder: "stroke fill", textShadow: "0 4px 8px rgba(0,0,0,.8)" }}>{lines.map((line) => <div key={line}><KeywordCaption text={line} keyword={caption?.keyword} /></div>)}</div>;
}

export const GithubDemo: React.FC<GithubDemoProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const timeMs = frame / fps * 1000;
  const camera = sampleCameraTrack(props.cameraTrack, timeMs);
  const event = activeEvent(props, timeMs);
  const sourceFrame = Math.max(0, Math.round(props.captureStartMs / 1000 * fps));
  const pageWidth = 1440;
  const pageHeight = 1080;
  const captionBand = Math.max(130, Math.round(height * 0.18));
  const frameWidth = Math.min(width - 80, Math.round((height - captionBand - 80) * 4 / 3));
  const frameHeight = Math.round(frameWidth * 3 / 4);
  const frameLeft = Math.round((width - frameWidth) / 2);
  const frameTop = Math.max(34, Math.round((height - captionBand - frameHeight) / 2));
  const fit = frameWidth / pageWidth;
  const css = poseToCss(camera.pose, fit);
  const pageLeft = frameLeft + (frameWidth - pageWidth * fit) / 2 + css.translateX * pageWidth;
  const pageTop = frameTop + (frameHeight - pageHeight * fit) / 2 + css.translateY * pageHeight;
  const box = event ? targetBoxAt(props, event, timeMs) : { x: 0, y: 0, width: 0, height: 0 };
  return (
    <AbsoluteFill style={{ background: "#00152B", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 20% 10%, rgba(0,129,190,.26), transparent 42%), radial-gradient(circle at 85% 90%, rgba(0,35,90,.9), transparent 52%)" }} />
      <div style={{ position: "absolute", left: frameLeft, top: frameTop, width: frameWidth, height: frameHeight, borderRadius: 16, overflow: "hidden", boxShadow: "0 28px 80px rgba(0,0,0,.54), 0 0 0 1px rgba(255,255,255,.13)" }}>
        <CameraMotionBlur shutterAngle={180} samples={6}>
          <div style={{ position: "absolute", width: pageWidth, height: pageHeight, left: pageLeft - frameLeft, top: pageTop - frameTop, transformOrigin: "0 0", transform: `scale(${css.scale}) rotate(${camera.rotation}deg)` }}>
            <OffthreadVideo src={staticFile(props.captureVideo)} startFrom={sourceFrame} muted style={{ width: pageWidth, height: pageHeight, objectFit: "fill", display: "block" }} />
            {props.showAnnotations && <AnnotationLayer props={props} timeMs={timeMs} box={box} />}
            {props.showCursor && <Cursor event={event} timeMs={timeMs} />}
          </div>
        </CameraMotionBlur>
      </div>
      {props.includeAudio && <Audio src={staticFile(props.narrationAudio)} />}
      {props.showSubtitles && <Subtitle props={props} timeMs={timeMs} />}
    </AbsoluteFill>
  );
};

export type { AnnotationType };
