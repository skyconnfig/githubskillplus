import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "../packages/evidence-engine/src/index.js";
import { generateScript } from "../packages/script-engine/src/index.js";
import { TargetRefSchema } from "../packages/shared/src/schemas.js";
import type { GitHubAnalysis } from "../packages/shared/src/types.js";

const analysis: GitHubAnalysis = {
  schemaVersion: 1,
  analyzedAt: "2026-08-31T00:00:00.000Z",
  githubUrl: "https://github.com/example/repo",
  owner: "example",
  name: "repo",
  fullName: "example/repo",
  title: "repo",
  description: "A demo project",
  stars: 10,
  forks: 2,
  watchers: 1,
  license: "MIT",
  languages: { TypeScript: 100 },
  topics: [],
  defaultBranch: "main",
  readme: "## Features\nA useful feature.",
  readmeHeadings: [{ heading: "Features", level: 2 }],
  sections: [{ heading: "Features", level: 2, body: "A useful feature.", category: "features" }],
  images: [],
  sources: ["https://github.com/example/repo"],
  warnings: [],
};

describe("evidence-bound script engine", () => {
  it("binds every offline line to an existing evidence item", async () => {
    const evidence = buildEvidenceGraph(analysis);
    const script = await generateScript(analysis, { offline: true, evidence, template: { id: "12s", durationMs: 12000, minScenes: 3, maxScenes: 6, pacing: "fast", aspect: "4:3" } });
    const ids = new Set(evidence.items.map((item) => item.id));
    expect(script.lines.every((line) => line.evidenceIds.length > 0 && line.evidenceIds.every((id) => ids.has(id)))).toBe(true);
  });

  it("rejects unknown TargetRef kinds", () => {
    expect(TargetRefSchema.safeParse({ kind: "random-target" }).success).toBe(false);
  });
});
