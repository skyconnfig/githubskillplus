import { createHash } from "node:crypto";
import type { EvidenceDocument, EvidenceItem, GitHubAnalysis, ReadmeSection, TargetRef } from "../../../packages/shared/src/types.js";

function stableId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function excerpt(value: string, max = 120): string {
  const text = value.replace(/[`*_>#]/g, "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function readmeTarget(value: string, preferredText?: string): TargetRef {
  const preferred = preferredText?.replace(/[`*_>#]/g, "").replace(/\s+/g, " ").trim();
  return { kind: "readme-text", text: preferred || excerpt(value, 90) || "README" };
}

function add(items: EvidenceItem[], item: Omit<EvidenceItem, "id">, key: string): void {
  items.push({ id: key.startsWith("ev-") ? key : `ev-${key}`, ...item });
}

function apiEvidence(analysis: GitHubAnalysis): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  add(items, { type: "repo", claim: `仓库名称是 ${analysis.fullName}`, value: analysis.fullName, source: "github-api", confidence: 1, target: { kind: "repo-title", text: analysis.name } }, "ev-repo-name");
  if (analysis.description) add(items, { type: "repo", claim: analysis.description, source: "github-api", confidence: 1, target: { kind: "repo-title", text: analysis.name } }, "ev-repo-description");
  add(items, { type: "metric", claim: `仓库有 ${analysis.stars} 个 Star`, value: analysis.stars, source: "github-api", confidence: 1, target: { kind: "stars", text: String(analysis.stars) } }, "ev-stars");
  add(items, { type: "metric", claim: `仓库有 ${analysis.forks} 个 Fork`, value: analysis.forks, source: "github-api", confidence: 1, target: { kind: "stars", text: String(analysis.forks) } }, "ev-forks");
  add(items, { type: "metric", claim: `仓库有 ${analysis.watchers} 个 Watcher`, value: analysis.watchers, source: "github-api", confidence: 1, target: { kind: "stars", text: String(analysis.stars) } }, "ev-watchers");
  if (analysis.topics.length > 0) add(items, { type: "repo", claim: `仓库主题包括 ${analysis.topics.join("、")}`, value: analysis.topics.join(","), source: "github-api", confidence: 1, target: { kind: "repo-title", text: analysis.name } }, "ev-topics");
  if (Object.keys(analysis.languages).length > 0) add(items, { type: "repo", claim: `仓库语言包括 ${Object.keys(analysis.languages).join("、")}`, value: Object.keys(analysis.languages).join(","), source: "github-api", confidence: 1, target: { kind: "repo-title", text: analysis.name } }, "ev-languages");
  if (analysis.license) add(items, { type: "repo", claim: `仓库许可证是 ${analysis.license}`, value: analysis.license, source: "github-api", confidence: 1, target: { kind: "repo-title", text: analysis.name } }, "ev-license");
  return items;
}

function sectionType(section: ReadmeSection): EvidenceItem["type"] {
  if (section.category === "features") return "feature";
  if (section.category === "benchmark") return "benchmark";
  if (section.category === "hardware") return "hardware";
  if (section.category === "installation") return "installation";
  if (section.category === "usage") return "usage";
  if (section.category === "demo") return "demo";
  if (section.category === "architecture") return "architecture";
  if (section.category === "requirements") return "requirement";
  return "feature";
}

function numericEvidence(section: ReadmeSection, line: string): Array<Omit<EvidenceItem, "id">> {
  const matches = line.match(/\b\d+(?:\.\d+)?\s*(?:k|m|b|%|x|×|tok(?:en)?s?\/s|t\/s|GB|GiB|MB|MiB|KB|ms|s|fps)\b(?:\s+(?:VRAM|RAM|memory))?/gi) ?? [];
  const hardware = line.match(/\b(?:RTX|GTX|RX|M\d|A\d{2,4}|CPU|GPU|CUDA)\s*[A-Za-z0-9+.-]*\b/gi) ?? [];
  const values = [...new Set([...matches, ...hardware])];
  return values.map((value) => ({ type: "metric", claim: `README 提到指标 ${value}`, value, source: "readme" as const, confidence: 0.88, target: readmeTarget(line, value), quote: excerpt(line, 220), section: section.heading }));
}

function readmeEvidence(analysis: GitHubAnalysis): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const section of analysis.sections) {
    const body = section.body.trim();
    if (!body) continue;
    const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? body;
    add(items, { type: sectionType(section), claim: `${section.heading}：${excerpt(firstLine)}`, source: "readme", confidence: 0.82, target: { kind: "readme-heading", heading: section.heading }, quote: excerpt(body, 280), section: section.heading }, `section-${section.heading}-${firstLine}`);
    for (const line of body.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      for (const item of numericEvidence(section, line)) add(items, item, `metric-${section.heading}-${line}-${item.value ?? ""}`);
    }
  }
  for (const image of analysis.images) add(items, { type: "image", claim: image.alt ? `README 图片：${image.alt}` : "README 包含图片", source: "readme", confidence: 0.8, target: { kind: "image", alt: image.alt }, value: image.url }, `image-${image.alt}-${image.url}`);
  return items;
}

export function buildEvidenceGraph(analysis: GitHubAnalysis, projectName = analysis.name): EvidenceDocument {
  const items = [...apiEvidence(analysis), ...readmeEvidence(analysis)];
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  return { schemaVersion: 1, projectName, githubUrl: analysis.githubUrl, items: unique, warnings: analysis.warnings };
}

export function evidenceById(document: EvidenceDocument): Map<string, EvidenceItem> {
  return new Map(document.items.map((item) => [item.id, item]));
}
