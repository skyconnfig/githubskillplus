export type VisualIntent =
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
}

export interface ScriptDocument {
  schemaVersion: 1;
  projectName: string;
  githubUrl: string;
  targetDurationMs: number;
  lines: ScriptLine[];
}

export type AnnotationType =
  | "hand-circle"
  | "hand-underline"
  | "hand-box"
  | "arrow"
  | "spotlight"
  | "text-selection";

export interface CameraIntent {
  desiredScale: number;
  rotation: number;
  transitionMs: number;
  padding: number;
}

export interface StoryboardScene {
  id: string;
  lineId: string;
  narration: string;
  source: { type: "github"; url: string; target: TargetRef };
  camera: CameraIntent;
  annotations: Array<{
    id: string;
    type: AnnotationType;
    target: TargetRef;
    color: string;
    strokeWidth: number;
  }>;
}

export interface StoryboardDocument {
  schemaVersion: 1;
  status: "draft" | "approved";
  project: {
    title: string;
    githubUrl: string;
    fps: 30;
    width: 1440;
    height: 1080;
    targetDurationMs: number;
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

export interface CaptureEvent extends LocatedTarget {
  sceneId: string;
  lineId: string;
  timestampMs: number;
  durationMs: number;
  cursorTrack: Array<{ timeMs: number; x: number; y: number }>;
}

export interface CaptureManifest {
  schemaVersion: 1;
  createdAt: string;
  videoPath: string;
  videoStartMs: number;
  viewport: { width: 1440; height: 1080 };
  screenshots: Record<string, string>;
  events: CaptureEvent[];
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

export interface CameraPose {
  scale: number;
  cx: number;
  cy: number;
}

export interface CameraKeyframe {
  timeMs: number;
  pose: CameraPose;
  rotation: number;
}

export interface CameraTrack {
  durationMs: number;
  frames: CameraKeyframe[];
}

export interface QualityReport {
  status: "pass" | "warn" | "fail";
  checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }>;
}
