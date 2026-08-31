export type VisualIntent =
  | "hook"
  | "establish"
  | "repo-intro"
  | "github-popularity"
  | "readme-highlight"
  | "feature"
  | "benchmark"
  | "hardware"
  | "architecture";

export type TargetRef =
  | { kind: "repo-title"; text: string }
  | { kind: "stars"; text?: string }
  | { kind: "readme-heading"; heading: string }
  | { kind: "readme-text"; text: string }
  | { kind: "image"; alt?: string }
  | { kind: "code-block"; text?: string };

export interface ReadmeSection {
  heading: string;
  level: number;
  body: string;
  category:
    | "features"
    | "benchmark"
    | "installation"
    | "usage"
    | "hardware"
    | "demo"
    | "requirements"
    | "architecture"
    | "other";
}

export interface GitHubImage {
  alt: string;
  url: string;
}

export interface GitHubAnalysis {
  schemaVersion: 1;
  analyzedAt: string;
  githubUrl: string;
  owner: string;
  name: string;
  fullName: string;
  title: string;
  description: string;
  stars: number;
  forks: number;
  watchers: number;
  license: string | null;
  languages: Record<string, number>;
  topics: string[];
  defaultBranch: string;
  readme: string;
  readmeHeadings: Array<{ heading: string; level: number }>;
  sections: ReadmeSection[];
  images: GitHubImage[];
  sources: string[];
  warnings: string[];
}

export interface ScriptLine {
  id: string;
  text: string;
  keyword: string;
  visualIntent: VisualIntent;
  githubTarget: TargetRef;
  importance: 1 | 2 | 3;
  evidenceIds: string[];
}

export interface ScriptDocument {
  schemaVersion: 1;
  projectName: string;
  githubUrl: string;
  targetDurationMs: number;
  lines: ScriptLine[];
}

export type EvidenceType =
  | "repo"
  | "metric"
  | "feature"
  | "benchmark"
  | "hardware"
  | "requirement"
  | "architecture"
  | "code"
  | "image"
  | "demo"
  | "installation"
  | "usage";

export type EvidenceSource = "github-api" | "readme" | "release" | "repository";

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  claim: string;
  value?: string | number;
  source: EvidenceSource;
  confidence: number;
  target: TargetRef;
  quote?: string;
  section?: string;
}

export interface EvidenceDocument {
  schemaVersion: 1;
  projectName: string;
  githubUrl: string;
  items: EvidenceItem[];
  warnings: string[];
}

export type AnnotationType =
  | "hand-circle"
  | "hand-underline"
  | "hand-box"
  | "arrow"
  | "spotlight"
  | "text-selection";

export type ExtendedAnnotationType = AnnotationType | "highlight" | "bracket" | "callout" | "number-badge" | "focus-ring";

export type CameraMode = "static" | "zoom-in" | "zoom-out" | "pan" | "follow-target" | "follow-cursor";
export type CameraEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring";

export interface CameraIntent {
  mode: CameraMode;
  desiredScale: number;
  rotation: number;
  transitionMs: number;
  holdMs?: number;
  padding: number;
  easing?: CameraEasing;
  followDelayMs?: number;
}

export interface AnnotationIntent {
  id: string;
  type: ExtendedAnnotationType;
  targetId: string;
  startMs: number;
  enterMs: number;
  holdMs: number;
  exitMs: number;
  color?: string;
  strokeWidth?: number;
  label?: string;
}

export interface StoryboardScene {
  id: string;
  lineId: string;
  narration: string;
  source: { type: "github"; url: string; target: TargetRef };
  startMs: number;
  endMs: number;
  beatType: VisualBeat["type"];
  targetId: string;
  camera: CameraIntent;
  annotations: AnnotationIntent[];
}

export interface StoryboardDocument {
  schemaVersion: 1;
  status: "draft" | "approved";
  project: {
    title: string;
    githubUrl: string;
    fps: 30;
    width: number;
    height: number;
    targetDurationMs: number;
    templateId: string;
    aspect: VideoAspect;
    style: "REFERENCE_TECH_EXPLAINER";
  };
  scenes: StoryboardScene[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocatedTarget {
  target: TargetRef;
  selector: string;
  text: string;
  boundingBox: BoundingBox;
  viewportWidth: number;
  viewportHeight: number;
  scrollY: number;
  pageUrl: string;
}

export interface PointerSample {
  timeMs: number;
  x: number;
  y: number;
  event: "move" | "down" | "up" | "click" | "idle";
  button?: "left" | "right" | "middle";
}

export interface ScrollSample {
  timeMs: number;
  scrollX: number;
  scrollY: number;
}

export interface TargetSample extends BoundingBox {
  timeMs: number;
  visible: boolean;
}

export interface TargetTrack {
  targetId: string;
  samples: TargetSample[];
}

export interface CaptureEvent extends LocatedTarget {
  sceneId: string;
  lineId: string;
  timestampMs: number;
  durationMs: number;
  targetId: string;
  cursorTrack: PointerSample[];
}

export type CaptureAction =
  | { type: "goto"; url: string }
  | { type: "scroll-to"; targetId: string; durationMs?: number }
  | { type: "scroll-by"; y: number; durationMs?: number }
  | { type: "cursor-move"; targetId: string; durationMs?: number }
  | { type: "hover"; targetId: string }
  | { type: "click"; targetId: string }
  | { type: "wait"; durationMs: number };

export type DirectorAction =
  | { type: "camera-zoom"; scale: number; targetId?: string; transitionMs?: number }
  | { type: "camera-pan"; targetId: string; transitionMs?: number }
  | { type: "camera-zoom-out"; transitionMs?: number }
  | { type: "hold"; durationMs: number }
  | { type: "cursor-move"; targetId: string; durationMs?: number }
  | { type: "cursor-click"; targetId: string; button?: "left" | "right" | "middle" }
  | { type: "annotation"; annotation: ExtendedAnnotationType; targetId: string }
  | { type: "goto"; url: string }
  | { type: "scroll-to"; targetId: string; durationMs?: number }
  | { type: "scroll-by"; y: number; durationMs?: number }
  | { type: "hover"; targetId: string }
  | { type: "click"; targetId: string }
  | { type: "wait"; durationMs: number };

export interface VisualBeat {
  id: string;
  sceneId: string;
  type: "hook" | "establish" | "proof" | "feature" | "benchmark" | "hardware" | "architecture" | "demo" | "summary";
  startMs: number;
  endMs: number;
  targetId?: string;
  importance: 1 | 2 | 3;
  actions: DirectorAction[];
  camera?: CameraIntent;
}

export interface DirectorPlan {
  schemaVersion: 1;
  projectName: string;
  templateId: string;
  aspect: VideoAspect;
  beats: VisualBeat[];
}

export interface CaptureManifest {
  schemaVersion: 1;
  createdAt: string;
  videoPath: string;
  videoStartMs: number;
  viewport: { width: number; height: number };
  screenshots: Record<string, string>;
  events: CaptureEvent[];
  pointerTrack: PointerSample[];
  scrollTrack: ScrollSample[];
  targetTracks: TargetTrack[];
}

export interface AudioSegment {
  lineId: string;
  text: string;
  audioPath: string;
  startMs: number;
  durationMs: number;
  endMs: number;
}

export interface AudioTimeline {
  schemaVersion: 1;
  audioPath: string;
  totalDurationMs: number;
  segments: AudioSegment[];
}

export interface WordTiming {
  id: string;
  lineId: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface WordTimeline {
  schemaVersion: 1;
  words: WordTiming[];
}

export interface CameraPose {
  scale: number;
  cx: number;
  cy: number;
}

export interface CameraKeyframe {
  timeMs: number;
  pose: CameraPose;
  rotation: number;
  easing?: CameraEasing;
}

export interface CameraTrack {
  durationMs: number;
  frames: CameraKeyframe[];
}

export interface QualityReport {
  status: "pass" | "warn" | "fail";
  checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }>;
}

export type VideoAspect = "16:9" | "4:3" | "3:4" | "9:16";

export interface VideoTemplate {
  id: "12s" | "30s" | "45s" | "60s";
  durationMs: number;
  minScenes: number;
  maxScenes: number;
  pacing: "fast" | "normal";
  aspect: VideoAspect;
}
