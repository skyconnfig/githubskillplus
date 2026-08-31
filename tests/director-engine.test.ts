import { describe, expect, it } from "vitest";
import { buildDirectorPlan } from "../packages/director-engine/src/index.js";
import type { AudioTimeline, EvidenceDocument, ScriptDocument, WordTimeline } from "../packages/shared/src/types.js";

describe("director engine", () => {
  it("creates evidence-targeted beats without zooming every line", () => {
    const script: ScriptDocument = { schemaVersion: 1, projectName: "example-repo", githubUrl: "https://github.com/example/repo", targetDurationMs: 30000, lines: [
      { id: "line-01", text: "项目", keyword: "项目", visualIntent: "repo-intro", githubTarget: { kind: "repo-title", text: "repo" }, importance: 1, evidenceIds: ["ev-repo-name"] },
      { id: "line-02", text: "数据", keyword: "数据", visualIntent: "github-popularity", githubTarget: { kind: "stars", text: "10" }, importance: 3, evidenceIds: ["ev-stars"] },
      { id: "line-03", text: "功能", keyword: "功能", visualIntent: "feature", githubTarget: { kind: "readme-text", text: "feature" }, importance: 1, evidenceIds: ["ev-feature"] },
    ] };
    const evidence: EvidenceDocument = { schemaVersion: 1, projectName: "example-repo", githubUrl: script.githubUrl, items: [
      { id: "ev-repo-name", type: "repo", claim: "repo", source: "github-api", confidence: 1, target: script.lines[0]!.githubTarget },
      { id: "ev-stars", type: "metric", claim: "10 stars", value: 10, source: "github-api", confidence: 1, target: script.lines[1]!.githubTarget },
      { id: "ev-feature", type: "feature", claim: "feature", source: "readme", confidence: 1, target: script.lines[2]!.githubTarget },
    ], warnings: [] };
    const audio: AudioTimeline = { schemaVersion: 1, audioPath: "voice.wav", totalDurationMs: 30000, segments: script.lines.map((line, index) => ({ lineId: line.id, text: line.text, audioPath: `${line.id}.wav`, startMs: index * 10000, durationMs: 10000, endMs: (index + 1) * 10000 })) };
    const words: WordTimeline = { schemaVersion: 1, words: [] };
    const plan = buildDirectorPlan(script, evidence, audio, words, { template: { id: "30s", durationMs: 30000, minScenes: 3, maxScenes: 10, pacing: "normal", aspect: "16:9" } });
    expect(plan.beats[1]!.targetId).toBe("ev-stars");
    expect(plan.beats[1]!.actions.some((action) => action.type === "annotation")).toBe(true);
    expect(plan.beats.filter((beat) => beat.camera?.mode === "zoom-in").length).toBeLessThan(plan.beats.length);
  });
});
