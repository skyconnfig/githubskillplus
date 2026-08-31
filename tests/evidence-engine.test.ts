import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "../packages/evidence-engine/src/index.js";
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
  stars: 8400,
  forks: 120,
  watchers: 80,
  license: "MIT",
  languages: { TypeScript: 90 },
  topics: ["automation"],
  defaultBranch: "main",
  readme: "## Benchmark\nIt reaches 39.3 tok/s on RTX 4060 with 8GB VRAM.",
  readmeHeadings: [{ heading: "Benchmark", level: 2 }],
  sections: [{ heading: "Benchmark", level: 2, body: "It reaches 39.3 tok/s on RTX 4060 with 8GB VRAM.", category: "benchmark" }],
  images: [],
  sources: ["https://github.com/example/repo"],
  warnings: [],
};

describe("evidence engine", () => {
  it("turns API and README metrics into deterministic evidence", () => {
    const first = buildEvidenceGraph(analysis);
    const second = buildEvidenceGraph(analysis);
    expect(first).toEqual(second);
    expect(first.items.find((item) => item.id === "ev-stars")?.value).toBe(8400);
    const metrics = first.items.filter((item) => item.type === "metric" && item.source === "readme");
    expect(metrics.map((item) => item.value)).toEqual(["39.3 tok/s", "8GB VRAM", "RTX 4060"]);
    expect(metrics.map((item) => item.target)).toEqual([
      { kind: "readme-text", text: "39.3 tok/s" },
      { kind: "readme-text", text: "8GB VRAM" },
      { kind: "readme-text", text: "RTX 4060" },
    ]);
  });
});
