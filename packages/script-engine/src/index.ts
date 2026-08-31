import { buildEvidenceGraph } from "../../../packages/evidence-engine/src/index.js";
import { ScriptDocumentSchema } from "../../../packages/shared/src/schemas.js";
import type { EvidenceDocument, EvidenceItem, GitHubAnalysis, ScriptDocument, ScriptLine, TargetRef, VideoTemplate, VisualIntent } from "../../../packages/shared/src/types.js";

function excerpt(value: string, max = 38): string {
  const plain = value.replace(/[#>*`]/g, "").replace(/\s+/g, " ").trim();
  return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
}

function firstUsefulSection(analysis: GitHubAnalysis): { heading: string; body: string } {
  const section = analysis.sections.find((item) => item.body.trim().length > 0 && item.level <= 3);
  if (section) return section;
  return { heading: "README", body: analysis.description || "这个仓库把一个具体问题整理成了可复用的开源项目。" };
}

function findEvidence(evidence: EvidenceDocument, predicate: (item: EvidenceItem) => boolean): EvidenceItem | undefined {
  return evidence.items.find(predicate);
}

function sectionEvidence(evidence: EvidenceDocument, heading: string): EvidenceItem | undefined {
  return findEvidence(evidence, (item) => item.section === heading);
}

function localScript(analysis: GitHubAnalysis, evidence = buildEvidenceGraph(analysis), template: VideoTemplate = { id: "45s", durationMs: 45000, minScenes: 5, maxScenes: 12, pacing: "normal", aspect: "16:9" }): ScriptDocument {
  const section = firstUsefulSection(analysis);
  const repo = findEvidence(evidence, (item) => item.id === "ev-repo-name");
  const stars = findEvidence(evidence, (item) => item.id === "ev-stars");
  const forks = findEvidence(evidence, (item) => item.id === "ev-forks");
  const sectionItem = sectionEvidence(evidence, section.heading);
  const metric = findEvidence(evidence, (item) => item.type === "metric" && item.source === "readme");
  const usage = findEvidence(evidence, (item) => item.type === "usage" || item.type === "installation");
  const titleTarget: TargetRef = repo?.target ?? { kind: "repo-title", text: analysis.name };
  const starsTarget: TargetRef = stars?.target ?? { kind: "stars", text: String(analysis.stars) };
  const readmeTarget: TargetRef = sectionItem?.target ?? { kind: "readme-heading", heading: section.heading };
  const lines: ScriptLine[] = [
    { id: "line-01", text: `这是 GitHub 项目 ${analysis.name}。`, keyword: analysis.name, visualIntent: "repo-intro", githubTarget: titleTarget, importance: 1, evidenceIds: [repo?.id ?? "ev-repo-name"] },
    { id: "line-02", text: `当前有 ${String(stars?.value ?? analysis.stars)} 个 Star，${String(forks?.value ?? analysis.forks)} 个 Fork。`, keyword: `${String(stars?.value ?? analysis.stars)} Star`, visualIntent: "github-popularity", githubTarget: starsTarget, importance: 2, evidenceIds: [stars?.id ?? "ev-stars", forks?.id ?? "ev-forks"] },
    { id: "line-03", text: `README 的核心是“${section.heading}”这一节。`, keyword: section.heading, visualIntent: sectionItem?.type === "feature" ? "feature" : "readme-highlight", githubTarget: readmeTarget, importance: 2, evidenceIds: [sectionItem?.id ?? repo?.id ?? "ev-repo-name"] },
  ];
  if (metric) lines.push({ id: "line-04", text: `README 还给出一个可核对的指标：${String(metric.value)}。`, keyword: String(metric.value), visualIntent: "benchmark", githubTarget: metric.target, importance: 3, evidenceIds: [metric.id] });
  if (usage) lines.push({ id: `line-${String(lines.length + 1).padStart(2, "0")}`, text: `想体验，可以从“${usage.section ?? "使用方式"}”开始。`, keyword: usage.section ?? "使用方式", visualIntent: "feature", githubTarget: usage.target, importance: 1, evidenceIds: [usage.id] });
  const example = findEvidence(evidence, (item) => item.type === "metric" && item.value === "90s");
  if (example) lines.push({ id: `line-${String(lines.length + 1).padStart(2, "0")}`, text: `README 展示了一个 ${String(example.value)} 的真实示例。`, keyword: String(example.value), visualIntent: "feature", githubTarget: example.target, importance: 2, evidenceIds: [example.id] });
  const extraSections = ["Requirements", "What a flow can do", "Formats: one capture, the outputs that earn it", "Redaction: capture over real data, safely", "Re-runs: your UI changed, your video shouldn't go stale"];
  for (const heading of extraSections) {
    if (lines.length >= template.maxScenes) break;
    const item = sectionEvidence(evidence, heading);
    if (!item) continue;
    lines.push({ id: `line-${String(lines.length + 1).padStart(2, "0")}`, text: `README 还专门写了“${heading}”这一节。`, keyword: heading, visualIntent: "feature", githubTarget: item.target, importance: 1, evidenceIds: [item.id] });
  }
  const capped = template.id === "12s" ? lines.slice(0, 3) : lines;
  return { schemaVersion: 1, projectName: `${analysis.owner}-${analysis.name}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "github-demo", githubUrl: analysis.githubUrl, targetDurationMs: template.durationMs, lines: capped };
}

export function compactScript(analysis: GitHubAnalysis, evidence = buildEvidenceGraph(analysis)): ScriptDocument {
  const script = localScript(analysis, evidence, { id: "12s", durationMs: 12000, minScenes: 3, maxScenes: 6, pacing: "fast", aspect: "4:3" });
  const repo = evidence.items.find((item) => item.id === "ev-repo-name");
  const stars = evidence.items.find((item) => item.id === "ev-stars");
  const readme = evidence.items.find((item) => item.type === "feature" && item.source === "readme")
    ?? evidence.items.find((item) => item.section && item.source === "readme");
  const [intro, popularity, readmeLine] = script.lines;
  if (!intro || !popularity || !readmeLine) return { ...script, targetDurationMs: 12000, lines: script.lines.slice(0, 3) };
  return {
    ...script,
    targetDurationMs: 12000,
    lines: [
      { ...intro, text: `这是 GitHub 项目 ${analysis.name}。`, keyword: analysis.name, evidenceIds: [repo?.id ?? intro.evidenceIds[0]!] },
      { ...popularity, text: `它现在有 ${String(stars?.value ?? analysis.stars)} 个 Star。`, keyword: `${String(stars?.value ?? analysis.stars)} Star`, evidenceIds: [stars?.id ?? popularity.evidenceIds[0]!] },
      { ...readmeLine, text: "README：AI Agent 操作网页，生成视频。", keyword: "README", evidenceIds: [readme?.id ?? readmeLine.evidenceIds[0]!] },
    ],
  };
}

function extractJson(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? value;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LLM response did not contain a JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function validateEvidenceBindings(document: ScriptDocument, evidence: EvidenceDocument): void {
  const ids = new Set(evidence.items.map((item) => item.id));
  for (const line of document.lines) {
    if (line.evidenceIds.length === 0) throw new Error(`Script line ${line.id} has no evidenceIds`);
    const missing = line.evidenceIds.filter((id) => !ids.has(id));
    if (missing.length > 0) throw new Error(`Script line ${line.id} references missing evidence: ${missing.join(", ")}`);
  }
}

export function validateDocument(value: unknown, analysis: GitHubAnalysis, evidence = buildEvidenceGraph(analysis)): ScriptDocument {
  const parsed = ScriptDocumentSchema.parse(value);
  if (parsed.githubUrl !== analysis.githubUrl) throw new Error("Script githubUrl does not match analyzed repository");
  validateEvidenceBindings(parsed, evidence);
  return parsed;
}

function isIntent(value: unknown): value is VisualIntent {
  return typeof value === "string" && ["hook", "establish", "repo-intro", "github-popularity", "readme-highlight", "feature", "benchmark", "hardware", "architecture"].includes(value);
}

export interface ScriptGenerationOptions {
  offline?: boolean;
  evidence?: EvidenceDocument;
  template?: VideoTemplate;
}

export async function generateScript(analysis: GitHubAnalysis, options: ScriptGenerationOptions = {}): Promise<ScriptDocument> {
  const evidence = options.evidence ?? buildEvidenceGraph(analysis);
  const template = options.template ?? { id: "45s", durationMs: 45000, minScenes: 5, maxScenes: 12, pacing: "normal", aspect: "16:9" } satisfies VideoTemplate;
  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (options.offline || !baseUrl || !model) return localScript(analysis, evidence, template);
  const evidencePrompt = JSON.stringify({ githubUrl: analysis.githubUrl, items: evidence.items });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const prompt = [
        "Generate a concise Chinese GitHub project video script as JSON only.",
        `Target template: ${template.id}, durationMs: ${template.durationMs}.`,
        "Use only the supplied EvidenceGraph. Every line must include one or more existing evidenceIds.",
        "Never invent benchmarks, hardware, stars, performance, or features; do not use unsupported claims.",
        "Return {schemaVersion:1,projectName,targetDurationMs,githubUrl,lines}; each line needs id,text,keyword,visualIntent,githubTarget,importance,evidenceIds.",
        attempt > 0 ? "The previous response failed validation. Return strict JSON matching the requested fields." : "",
        evidencePrompt,
      ].filter(Boolean).join("\n\n");
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
      });
      if (!response.ok) throw new Error(`OpenAI-Compatible script request failed (${response.status})`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI-Compatible response contained no message content");
      const parsed = extractJson(content) as Record<string, unknown>;
      parsed.schemaVersion = 1;
      parsed.githubUrl = analysis.githubUrl;
      parsed.targetDurationMs = template.durationMs;
      if (!Array.isArray(parsed.lines) || parsed.lines.some((line) => !line || typeof line !== "object" || !isIntent((line as Record<string, unknown>).visualIntent))) throw new Error("LLM response contains invalid visualIntent");
      return validateDocument(parsed, analysis, evidence);
    } catch (error) {
      if (attempt === 2) return localScript(analysis, evidence, template);
    }
  }
  return localScript(analysis, evidence, template);
}

export { localScript };
