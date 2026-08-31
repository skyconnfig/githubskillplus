import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { createAnnotationGeometry } from "../../../packages/annotation-engine/src/index.js";
import { poseToCss, sampleCameraTrack } from "../../../packages/camera-engine/src/index.js";
import { wrapCaption } from "../../../packages/subtitle-engine/src/index.js";
import type { AnnotationType, CameraTrack, CaptureEvent, StoryboardDocument } from "../../../packages/shared/src/types.js";

export interface GithubDemoProps {
  captureVideo: string;
  narrationAudio: string;
  captureStartMs: number;
  cameraTrack: CameraTrack;
  captureEvents: CaptureEvent[];
  storyboard: Pick<StoryboardDocument, "scenes">;
  subtitles: Array<{ startMs: number; endMs: number; text: string }>;
  showAnnotations: boolean;
  showCursor: boolean;
  showSubtitles: boolean;
  includeAudio: boolean;
}

const pink = "#FF00DC";

function activeEvent(props: GithubDemoProps, timeMs: number): CaptureEvent | undefined {
  return props.captureEvents.find((event) => timeMs >= event.timestampMs && timeMs < event.timestampMs + event.durationMs);
}

function AnnotationLayer({ props, timeMs }: { props: GithubDemoProps; timeMs: number }): React.ReactElement {
  const event = props.showAnnotations || props.showCursor ? activeEvent(props, timeMs) : undefined;
  const scene = event ? props.storyboard.scenes.find((item) => item.id === event.sceneId) : undefined;
  if (!event || !scene) return <></>;
  const visibleFrom = event.timestampMs + 180;
  const progress = Math.max(0, Math.min(1, (timeMs - visibleFrom) / 380));
  const pathAnnotations = scene.annotations.filter((annotation) => annotation.type === "hand-circle" || annotation.type === "hand-underline" || annotation.type === "hand-box" || annotation.type === "arrow");
  const geometries = pathAnnotations.map((annotation) => ({ annotation, geometry: createAnnotationGeometry(annotation.type, event.boundingBox, annotation.id) }));
  const maskId = `spotlight-${scene.id}`;
  return (
    <svg width="1440" height="1080" viewBox="0 0 1440 1080" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
      {scene.annotations.some((annotation) => annotation.type === "spotlight") && (
        <>
          <defs>
            <mask id={maskId}>
              <rect width="1440" height="1080" fill="white" />
              <rect x={event.boundingBox.x - 10} y={event.boundingBox.y - 10} width={event.boundingBox.width + 20} height={event.boundingBox.height + 20} rx="12" fill="black" />
            </mask>
          </defs>
          <rect width="1440" height="1080" fill="rgba(0,0,0,.42)" mask={`url(#${maskId})`} opacity={progress} />
        </>
      )}
      {scene.annotations.some((annotation) => annotation.type === "text-selection") && <rect x={event.boundingBox.x} y={event.boundingBox.y} width={event.boundingBox.width} height={event.boundingBox.height} rx="3" fill="rgba(59,130,246,.48)" opacity={progress} />}
      {geometries.map(({ annotation, geometry }) => geometry.path ? <path key={annotation.id} d={geometry.path} fill="none" stroke={annotation.color || pink} strokeWidth={annotation.strokeWidth || 10} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - progress} opacity={progress} /> : null)}
    </svg>
  );
}

function Cursor({ event, timeMs }: { event: CaptureEvent | undefined; timeMs: number }): React.ReactElement {
  const track = event?.cursorTrack ?? [];
  const localMs = event ? timeMs - event.timestampMs : 0;
  const first = track[0] ?? { timeMs: 0, x: 720, y: 540 };
  const last = track[track.length - 1] ?? first;
  const next = track.find((point) => point.timeMs >= localMs) ?? last;
  const previous = track.slice().reverse().find((point) => point.timeMs <= localMs) ?? first;
  const span = Math.max(1, next.timeMs - previous.timeMs);
  const progress = Math.max(0, Math.min(1, (localMs - previous.timeMs) / span));
  const x = previous.x + (next.x - previous.x) * progress;
  const y = previous.y + (next.y - previous.y) * progress;
  return <div style={{ position: "absolute", left: x, top: y, width: 24, height: 24, borderRadius: "50%", border: "3px solid white", background: "rgba(255,0,220,.72)", boxShadow: "0 0 0 5px rgba(255,0,220,.24), 0 0 18px rgba(255,0,220,.8)", transform: "translate(-50%,-50%)", pointerEvents: "none", opacity: event && timeMs >= event.timestampMs ? 1 : 0 }} />;
}

function Subtitle({ props, timeMs }: { props: GithubDemoProps; timeMs: number }): React.ReactElement {
  const caption = props.subtitles.find((item) => timeMs >= item.startMs && timeMs < item.endMs);
  return <div style={{ position: "absolute", left: 100, right: 100, bottom: 30, minHeight: 90, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#FFD800", fontFamily: "Microsoft YaHei, Arial, sans-serif", fontWeight: 900, fontSize: 50, lineHeight: 1.25, whiteSpace: "pre-line", WebkitTextStroke: "5px #090d17", paintOrder: "stroke fill", textShadow: "0 4px 8px rgba(0,0,0,.8)" }}>{caption ? wrapCaption(caption.text) : ""}</div>;
}

export const GithubDemo: React.FC<GithubDemoProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeMs = frame / fps * 1000;
  const camera = sampleCameraTrack(props.cameraTrack, timeMs);
  const css = poseToCss(camera.pose, 0.86);
  const event = activeEvent(props, timeMs);
  const sourceFrame = Math.max(0, Math.round(props.captureStartMs / 1000 * fps));
  const fit = 0.86;
  const frameWidth = 1280;
  const frameHeight = 960;
  const pageWidth = 1440;
  const pageHeight = 1080;
  const baseX = (frameWidth - pageWidth * fit) / 2;
  const baseY = (frameHeight - pageHeight * fit) / 2;
  const pageLeft = baseX + css.translateX * pageWidth;
  const pageTop = baseY + css.translateY * pageHeight;
  return (
    <AbsoluteFill style={{ background: "#00152B", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 20% 10%, rgba(0,129,190,.26), transparent 42%), radial-gradient(circle at 85% 90%, rgba(0,35,90,.9), transparent 52%)" }} />
      <div style={{ position: "absolute", left: 80, top: 64, width: 1280, height: 960, borderRadius: 16, overflow: "hidden", boxShadow: "0 28px 80px rgba(0,0,0,.54), 0 0 0 1px rgba(255,255,255,.13)" }}>
        <CameraMotionBlur shutterAngle={180} samples={6}>
          <div style={{ position: "absolute", width: pageWidth, height: pageHeight, left: pageLeft, top: pageTop, transformOrigin: "0 0", transform: `scale(${css.scale}) rotate(${camera.rotation}deg)` }}>
            <OffthreadVideo src={staticFile(props.captureVideo)} startFrom={sourceFrame} muted style={{ width: 1440, height: 1080, objectFit: "fill", display: "block" }} />
            {props.showAnnotations && <AnnotationLayer props={props} timeMs={timeMs} />}
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
