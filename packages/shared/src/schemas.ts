import { z } from "zod";

export const TargetRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("repo-title"), text: z.string().min(1) }),
  z.object({ kind: z.literal("stars"), text: z.string().optional() }),
  z.object({ kind: z.literal("readme-heading"), heading: z.string().min(1) }),
  z.object({ kind: z.literal("readme-text"), text: z.string().min(1) }),
  z.object({ kind: z.literal("image"), alt: z.string().optional() }),
  z.object({ kind: z.literal("code-block"), text: z.string().optional() }),
]);

const VisualIntentSchema = z.enum([
  "hook",
  "establish",
  "repo-intro",
  "github-popularity",
  "readme-highlight",
  "feature",
  "benchmark",
  "hardware",
  "architecture",
]);

const EvidenceTypeSchema = z.enum([
  "repo",
  "metric",
  "feature",
  "benchmark",
  "hardware",
  "requirement",
  "architecture",
  "code",
  "image",
  "demo",
  "installation",
  "usage",
]);

const EvidenceSourceSchema = z.enum(["github-api", "readme", "release", "repository"]);

export const EvidenceItemSchema = z.object({
  id: z.string().min(1),
  type: EvidenceTypeSchema,
  claim: z.string().min(1),
  value: z.union([z.string(), z.number()]).optional(),
  source: EvidenceSourceSchema,
  confidence: z.number().min(0).max(1),
  target: TargetRefSchema,
  quote: z.string().optional(),
  section: z.string().optional(),
});

export const EvidenceDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string().min(1),
  githubUrl: z.string().url(),
  items: z.array(EvidenceItemSchema),
  warnings: z.array(z.string()),
});

export const ScriptLineSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  keyword: z.string(),
  visualIntent: VisualIntentSchema,
  githubTarget: TargetRefSchema,
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  evidenceIds: z.array(z.string()),
});

export const ScriptDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string().min(1),
  githubUrl: z.string().url(),
  targetDurationMs: z.number().int().positive(),
  lines: z.array(ScriptLineSchema).min(1),
});

const CameraModeSchema = z.enum(["static", "zoom-in", "zoom-out", "pan", "follow-target", "follow-cursor"]);
const CameraEasingSchema = z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "spring"]);

export const CameraIntentSchema = z.object({
  mode: CameraModeSchema,
  desiredScale: z.number().min(0.5).max(2.8),
  rotation: z.number().finite(),
  transitionMs: z.number().int().nonnegative(),
  holdMs: z.number().int().nonnegative().optional(),
  padding: z.number().nonnegative(),
  easing: CameraEasingSchema.optional(),
  followDelayMs: z.number().int().nonnegative().optional(),
});

const AnnotationTypeSchema = z.enum([
  "hand-circle",
  "hand-underline",
  "hand-box",
  "arrow",
  "spotlight",
  "text-selection",
  "highlight",
  "bracket",
  "callout",
  "number-badge",
  "focus-ring",
]);

export const AnnotationIntentSchema = z.object({
  id: z.string().min(1),
  type: AnnotationTypeSchema,
  targetId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  enterMs: z.number().int().nonnegative(),
  holdMs: z.number().int().nonnegative(),
  exitMs: z.number().int().nonnegative(),
  color: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  label: z.string().optional(),
});

const BeatTypeSchema = z.enum(["hook", "establish", "proof", "feature", "benchmark", "hardware", "architecture", "demo", "summary"]);
const AspectSchema = z.enum(["16:9", "4:3", "3:4", "9:16"]);

export const StoryboardSceneSchema = z.object({
  id: z.string().min(1),
  lineId: z.string().min(1),
  narration: z.string().min(1),
  source: z.object({ type: z.literal("github"), url: z.string().url(), target: TargetRefSchema }),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  beatType: BeatTypeSchema,
  targetId: z.string().min(1),
  camera: CameraIntentSchema,
  annotations: z.array(AnnotationIntentSchema),
});

export const StoryboardDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["draft", "approved"]),
  project: z.object({
    title: z.string().min(1),
    githubUrl: z.string().url(),
    fps: z.literal(30),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    targetDurationMs: z.number().int().positive(),
    templateId: z.string().min(1),
    aspect: AspectSchema,
    style: z.literal("REFERENCE_TECH_EXPLAINER"),
  }),
  scenes: z.array(StoryboardSceneSchema).min(1),
});

export const AudioSegmentSchema = z.object({
  lineId: z.string().min(1),
  text: z.string().min(1),
  audioPath: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  endMs: z.number().int().positive(),
});

export const AudioTimelineSchema = z.object({
  schemaVersion: z.literal(1),
  audioPath: z.string().min(1),
  totalDurationMs: z.number().int().positive(),
  segments: z.array(AudioSegmentSchema).min(1),
});

export const WordTimingSchema = z.object({
  id: z.string().min(1),
  lineId: z.string().min(1),
  text: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});

export const WordTimelineSchema = z.object({ schemaVersion: z.literal(1), words: z.array(WordTimingSchema) });

export const CameraPoseSchema = z.object({ scale: z.number().min(0.5).max(2.8), cx: z.number().min(0).max(1), cy: z.number().min(0).max(1) });
export const CameraKeyframeSchema = z.object({ timeMs: z.number().int().nonnegative(), pose: CameraPoseSchema, rotation: z.number().finite(), easing: CameraEasingSchema.optional() });
export const CameraTrackSchema = z.object({ durationMs: z.number().int().positive(), frames: z.array(CameraKeyframeSchema).min(1) });

const PointerEventSchema = z.enum(["move", "down", "up", "click", "idle"]);
export const PointerSampleSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  event: PointerEventSchema,
  button: z.enum(["left", "right", "middle"]).optional(),
});
export const ScrollSampleSchema = z.object({ timeMs: z.number().int().nonnegative(), scrollX: z.number().finite(), scrollY: z.number().finite() });
export const TargetSampleSchema = z.object({ timeMs: z.number().int().nonnegative(), x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative(), visible: z.boolean() });
export const TargetTrackSchema = z.object({ targetId: z.string().min(1), samples: z.array(TargetSampleSchema).min(1) });

export const CaptureEventSchema = z.object({
  target: TargetRefSchema,
  selector: z.string().min(1),
  text: z.string(),
  boundingBox: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() }),
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
  scrollY: z.number().finite(),
  pageUrl: z.string().url(),
  sceneId: z.string().min(1),
  lineId: z.string().min(1),
  targetId: z.string().min(1),
  timestampMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  cursorTrack: z.array(PointerSampleSchema),
});

export const CaptureManifestSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime(),
  videoPath: z.string().min(1),
  videoStartMs: z.number().int().nonnegative(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  screenshots: z.record(z.string(), z.string()),
  events: z.array(CaptureEventSchema).min(1),
  pointerTrack: z.array(PointerSampleSchema),
  scrollTrack: z.array(ScrollSampleSchema),
  targetTracks: z.array(TargetTrackSchema),
});

const CameraActionSchema = z.union([
  z.object({ type: z.literal("camera-zoom"), scale: z.number().min(0.5).max(2.8), targetId: z.string().optional(), transitionMs: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("camera-pan"), targetId: z.string().min(1), transitionMs: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("camera-zoom-out"), transitionMs: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("hold"), durationMs: z.number().int().positive() }),
]);
const CursorActionSchema = z.union([
  z.object({ type: z.literal("cursor-move"), targetId: z.string().min(1), durationMs: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("cursor-click"), targetId: z.string().min(1), button: z.enum(["left", "right", "middle"]).optional() }),
]);
const CaptureActionSchema = z.union([
  z.object({ type: z.literal("goto"), url: z.string().url() }),
  z.object({ type: z.literal("scroll-to"), targetId: z.string().min(1), durationMs: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("scroll-by"), y: z.number().finite(), durationMs: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("hover"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("click"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("wait"), durationMs: z.number().int().positive() }),
]);
const AnnotationActionSchema = z.object({ type: z.literal("annotation"), annotation: AnnotationTypeSchema, targetId: z.string().min(1) });
export const DirectorActionSchema = z.union([CameraActionSchema, CursorActionSchema, CaptureActionSchema, AnnotationActionSchema]);

export const VisualBeatSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  type: BeatTypeSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  targetId: z.string().optional(),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  actions: z.array(DirectorActionSchema),
  camera: CameraIntentSchema.optional(),
});
export const DirectorPlanSchema = z.object({ schemaVersion: z.literal(1), projectName: z.string().min(1), templateId: z.string().min(1), aspect: AspectSchema, beats: z.array(VisualBeatSchema).min(1) });

export const QualityCheckSchema = z.object({ name: z.string().min(1), status: z.enum(["pass", "warn", "fail"]), message: z.string() });
export const QualityReportSchema = z.object({ status: z.enum(["pass", "warn", "fail"]), checks: z.array(QualityCheckSchema) });
export const VideoTemplateSchema = z.object({ id: z.enum(["12s", "30s", "45s", "60s"]), durationMs: z.number().int().positive(), minScenes: z.number().int().positive(), maxScenes: z.number().int().positive(), pacing: z.enum(["fast", "normal"]), aspect: AspectSchema });

export function parseEvidenceDocument(value: unknown) { return EvidenceDocumentSchema.parse(value); }
export function parseScriptDocument(value: unknown) { return ScriptDocumentSchema.parse(value); }
export function parseStoryboardDocument(value: unknown) { return StoryboardDocumentSchema.parse(value); }
export function parseAudioTimeline(value: unknown) { return AudioTimelineSchema.parse(value); }
export function parseWordTimeline(value: unknown) { return WordTimelineSchema.parse(value); }
export function parseCameraTrack(value: unknown) { return CameraTrackSchema.parse(value); }
export function parseCaptureManifest(value: unknown) { return CaptureManifestSchema.parse(value); }
export function parseDirectorPlan(value: unknown) { return DirectorPlanSchema.parse(value); }
export function parseQualityReport(value: unknown) { return QualityReportSchema.parse(value); }
