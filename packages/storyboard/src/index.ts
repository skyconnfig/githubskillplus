import type { AudioTimeline, CameraIntent, DirectorPlan, GitHubAnalysis, ScriptDocument, StoryboardDocument, StoryboardScene, VideoAspect, VideoTemplate } from "../../../packages/shared/src/types.js";

const templates: Record<VideoTemplate["id"], VideoTemplate> = {
  "12s": { id: "12s", durationMs: 12000, minScenes: 3, maxScenes: 6, pacing: "fast", aspect: "4:3" },
  "30s": { id: "30s", durationMs: 30000, minScenes: 4, maxScenes: 10, pacing: "normal", aspect: "16:9" },
  "45s": { id: "45s", durationMs: 45000, minScenes: 5, maxScenes: 12, pacing: "normal", aspect: "16:9" },
  "60s": { id: "60s", durationMs: 60000, minScenes: 6, maxScenes: 16, pacing: "normal", aspect: "16:9" },
};

function dimensionsFor(aspect: VideoAspect): { width: number; height: number } {
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  if (aspect === "4:3") return { width: 1440, height: 1080 };
  if (aspect === "3:4") return { width: 1080, height: 1440 };
  return { width: 1080, height: 1920 };
}

function cameraFor(intent: string, index: number): CameraIntent {
  if (intent === "github-popularity" || intent === "benchmark") return { mode: "zoom-in", desiredScale: 2.25, rotation: 0.8, transitionMs: 560, holdMs: 700, padding: 36, easing: "ease-in-out" };
  if (intent === "readme-highlight" || intent === "feature") return { mode: "pan", desiredScale: 1.65, rotation: -1.2, transitionMs: 620, holdMs: 700, padding: 54, easing: "ease-in-out" };
  return { mode: index === 0 ? "zoom-in" : "follow-target", desiredScale: index === 0 ? 1.55 : 1.7, rotation: -0.6, transitionMs: 560, holdMs: 700, padding: 64, easing: "ease-in-out" };
}

function beatTypeFor(intent: string): StoryboardScene["beatType"] {
  if (intent === "repo-intro") return "establish";
  if (intent === "github-popularity" || intent === "benchmark") return "proof";
  if (intent === "feature") return "feature";
  if (intent === "hardware") return "hardware";
  if (intent === "architecture") return "architecture";
  return "demo";
}

function annotationsFor(sceneId: string, targetId: string, line: { visualIntent: string }): StoryboardScene["annotations"] {
  if (line.visualIntent === "github-popularity" || line.visualIntent === "benchmark") return [{ id: `${sceneId}-stars-circle`, type: "hand-circle", targetId, startMs: 180, enterMs: 380, holdMs: 700, exitMs: 180, color: "#FF00DC", strokeWidth: 11 }];
  if (line.visualIntent === "readme-highlight") return [
    { id: `${sceneId}-readme-selection`, type: "text-selection", targetId, startMs: 160, enterMs: 320, holdMs: 900, exitMs: 180, color: "#3B82F6", strokeWidth: 0 },
    { id: `${sceneId}-readme-spotlight`, type: "spotlight", targetId, startMs: 0, enterMs: 260, holdMs: 1100, exitMs: 240, color: "#000000", strokeWidth: 0 },
  ];
  return [{ id: `${sceneId}-title-circle`, type: "hand-circle", targetId, startMs: 180, enterMs: 380, holdMs: 700, exitMs: 180, color: "#FF00DC", strokeWidth: 11 }];
}

export function getVideoTemplate(id: VideoTemplate["id"] = "45s"): VideoTemplate { return templates[id]; }

export function buildStoryboard(analysis: GitHubAnalysis, script: ScriptDocument, options: { audioTimeline?: AudioTimeline; directorPlan?: DirectorPlan; templateId?: VideoTemplate["id"]; aspect?: VideoAspect } = {}): StoryboardDocument {
  const template = getVideoTemplate(options.templateId ?? (script.targetDurationMs <= 12000 ? "12s" : "45s"));
  const aspect = options.aspect ?? template.aspect;
  const dimensions = dimensionsFor(aspect);
  const defaultDuration = options.audioTimeline?.totalDurationMs ?? script.targetDurationMs;
  const scenes: StoryboardScene[] = script.lines.map((line, index) => {
    const id = `scene-${String(index + 1).padStart(3, "0")}`;
    const segment = options.audioTimeline?.segments.find((item) => item.lineId === line.id);
    const startMs = segment?.startMs ?? Math.round(defaultDuration * index / Math.max(1, script.lines.length));
    const endMs = segment?.endMs ?? Math.round(defaultDuration * (index + 1) / Math.max(1, script.lines.length));
    const targetId = line.evidenceIds[0] ?? `target-${line.id}`;
    const planned = options.directorPlan?.beats.find((beat) => beat.sceneId === id);
    return { id, lineId: line.id, narration: line.text, source: { type: "github", url: analysis.githubUrl, target: line.githubTarget }, startMs, endMs, beatType: planned?.type ?? beatTypeFor(line.visualIntent), targetId, camera: cameraFor(line.visualIntent, index), annotations: annotationsFor(id, targetId, line) };
  });
  if (options.directorPlan) {
    for (const scene of scenes) {
      const beat = options.directorPlan.beats.find((item) => item.sceneId === scene.id);
      if (!beat) continue;
      scene.startMs = beat.startMs;
      scene.endMs = beat.endMs;
      scene.beatType = beat.type;
      if (beat.camera) scene.camera = beat.camera;
    }
  }
  return { schemaVersion: 1, status: "approved", project: { title: analysis.title, githubUrl: analysis.githubUrl, fps: 30, width: dimensions.width, height: dimensions.height, targetDurationMs: defaultDuration, templateId: template.id, aspect, style: "REFERENCE_TECH_EXPLAINER" }, scenes };
}

export { dimensionsFor };
