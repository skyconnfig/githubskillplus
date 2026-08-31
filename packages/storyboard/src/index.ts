import type { GitHubAnalysis, ScriptDocument, StoryboardDocument, StoryboardScene, TargetRef } from "../../../packages/shared/src/types.js";

function cameraFor(intent: string, index: number): { desiredScale: number; rotation: number; transitionMs: number; padding: number } {
  if (intent === "github-popularity") return { desiredScale: 2.25, rotation: 0.8, transitionMs: 560, padding: 36 };
  if (intent === "readme-highlight") return { desiredScale: 1.65, rotation: -1.2, transitionMs: 620, padding: 54 };
  return { desiredScale: index === 0 ? 1.55 : 1.7, rotation: -0.6, transitionMs: 560, padding: 64 };
}

function annotationsFor(sceneId: string, line: { visualIntent: string; githubTarget: TargetRef }): StoryboardScene["annotations"] {
  if (line.visualIntent === "github-popularity") return [{ id: `${sceneId}-stars-circle`, type: "hand-circle", target: line.githubTarget, color: "#FF00DC", strokeWidth: 11 }];
  if (line.visualIntent === "readme-highlight") return [
    { id: `${sceneId}-readme-selection`, type: "text-selection", target: line.githubTarget, color: "#3B82F6", strokeWidth: 0 },
    { id: `${sceneId}-readme-spotlight`, type: "spotlight", target: line.githubTarget, color: "#000000", strokeWidth: 0 },
  ];
  return [{ id: `${sceneId}-title-circle`, type: "hand-circle", target: line.githubTarget, color: "#FF00DC", strokeWidth: 11 }];
}

export function buildStoryboard(analysis: GitHubAnalysis, script: ScriptDocument): StoryboardDocument {
  const scenes: StoryboardScene[] = script.lines.map((line, index) => {
    const id = `scene-${String(index + 1).padStart(3, "0")}`;
    return { id, lineId: line.id, narration: line.text, source: { type: "github", url: analysis.githubUrl, target: line.githubTarget }, camera: cameraFor(line.visualIntent, index), annotations: annotationsFor(id, line) };
  });
  return { schemaVersion: 1, status: "approved", project: { title: analysis.title, githubUrl: analysis.githubUrl, fps: 30, width: 1440, height: 1080, targetDurationMs: script.targetDurationMs, style: "REFERENCE_TECH_EXPLAINER" }, scenes };
}
