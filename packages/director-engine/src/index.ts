import type { AudioTimeline, CameraIntent, DirectorAction, DirectorPlan, EvidenceDocument, ScriptDocument, VideoAspect, VideoTemplate, VisualBeat, WordTimeline } from "../../../packages/shared/src/types.js";

function beatType(intent: ScriptDocument["lines"][number]["visualIntent"]): VisualBeat["type"] {
  if (intent === "repo-intro" || intent === "establish") return "establish";
  if (intent === "github-popularity" || intent === "benchmark") return "proof";
  if (intent === "feature") return "feature";
  if (intent === "hardware") return "hardware";
  if (intent === "architecture") return "architecture";
  if (intent === "hook") return "hook";
  return "demo";
}

function cameraFor(importance: 1 | 2 | 3, index: number, intent: string): CameraIntent {
  if (importance === 3 || intent === "benchmark" || intent === "github-popularity") return { mode: "zoom-in", desiredScale: 2.15, rotation: 0, transitionMs: 560, holdMs: 900, padding: 36, easing: "ease-in-out" };
  if (importance === 2) return { mode: index % 2 === 0 ? "pan" : "follow-target", desiredScale: 1.6, rotation: 0, transitionMs: 520, holdMs: 700, padding: 52, easing: "ease-in-out" };
  return { mode: index === 0 ? "zoom-in" : "follow-target", desiredScale: index === 0 ? 1.35 : 1, rotation: 0, transitionMs: 480, holdMs: 600, padding: 64, easing: "ease-out" };
}

function targetIdFor(line: ScriptDocument["lines"][number], evidence: EvidenceDocument): string {
  const id = line.evidenceIds.find((evidenceId) => evidence.items.some((item) => item.id === evidenceId));
  return id ?? `target-${line.id}`;
}

function annotationFor(intent: string, importance: 1 | 2 | 3): "hand-circle" | "hand-underline" | "hand-box" | "spotlight" {
  if (intent === "benchmark" || intent === "github-popularity" || importance === 3) return "hand-circle";
  if (intent === "readme-highlight" || intent === "feature") return "spotlight";
  return "hand-underline";
}

export function buildDirectorPlan(script: ScriptDocument, evidence: EvidenceDocument, audio: AudioTimeline, words: WordTimeline, options: { template: VideoTemplate; aspect?: VideoAspect } ): DirectorPlan {
  const aspect = options.aspect ?? options.template.aspect;
  const beats: VisualBeat[] = script.lines.map((line, index) => {
    const segment = audio.segments.find((item) => item.lineId === line.id);
    const startMs = segment?.startMs ?? 0;
    const endMs = segment?.endMs ?? startMs + 1;
    const targetId = targetIdFor(line, evidence);
    const type = beatType(line.visualIntent);
    const camera = cameraFor(line.importance, index, line.visualIntent);
    const actions: DirectorAction[] = [];
    if (index === 0) actions.push({ type: "goto", url: script.githubUrl });
    actions.push({ type: "scroll-to", targetId, durationMs: Math.min(700, Math.max(300, camera.transitionMs)) });
    actions.push({ type: "cursor-move", targetId, durationMs: 420 });
    if (camera.mode === "zoom-in") actions.push({ type: "camera-zoom", targetId, scale: camera.desiredScale, transitionMs: camera.transitionMs });
    else if (camera.mode === "pan" || camera.mode === "follow-target") actions.push({ type: "camera-pan", targetId, transitionMs: camera.transitionMs });
    if (line.importance >= 2) actions.push({ type: "annotation", annotation: annotationFor(line.visualIntent, line.importance), targetId });
    if (line.importance === 3) actions.push({ type: "hold", durationMs: Math.max(700, camera.holdMs ?? 700) });
    else actions.push({ type: "hold", durationMs: Math.max(320, camera.holdMs ?? 500) });
    if (index > 0 && index < script.lines.length - 1 && line.importance === 1) actions.push({ type: "camera-zoom-out", transitionMs: 420 });
    return { id: `beat-${String(index + 1).padStart(3, "0")}`, sceneId: `scene-${String(index + 1).padStart(3, "0")}`, type, startMs, endMs, targetId, importance: line.importance, actions, camera };
  });
  void words;
  return { schemaVersion: 1, projectName: script.projectName, templateId: options.template.id, aspect, beats };
}
