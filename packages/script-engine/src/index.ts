import type { GitHubAnalysis, ScriptDocument, ScriptLine, TargetRef, VisualIntent } from "../../../packages/shared/src/types.js";

function excerpt(value: string, max = 38): string {
  const plain = value.replace(/[#>*`]/g, "").replace(/\s+/g, " ").trim();
  return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
}

function firstUsefulSection(analysis: GitHubAnalysis): { heading: string; body: string } {
  const section = analysis.sections.find((item) => item.body.trim().length > 0 && item.level <= 3);
  if (section) return section;
  return { heading: "README", body: analysis.description || "这个仓库把一个具体问题整理成了可复用的开源项目。" };
}

function localScript(analysis: GitHubAnalysis): ScriptDocument {
  const section = firstUsefulSection(analysis);
  const titleTarget: TargetRef = { kind: "repo-title", text: analysis.name };
  const starsTarget: TargetRef = { kind: "stars", text: String(analysis.stars) };
  const readmeText = excerpt(section.body, 34);
  const readmeTarget: TargetRef = { kind: "readme-text", text: readmeText };
  const lines: ScriptLine[] = [
    {
      id: "line-01",
      text: `这是 GitHub 项目 ${analysis.name}：${excerpt(analysis.description || "一个可以直接研究的开源实现", 30)}。`,
      keyword: analysis.name,
      visualIntent: "repo-intro",
      githubTarget: titleTarget,
      importance: 1,
    },
    {
      id: "line-02",
      text: `当前有 ${analysis.stars} 个 Star，${analysis.forks} 个 Fork。`,
      keyword: `${analysis.stars} Star`,
      visualIntent: "github-popularity",
      githubTarget: starsTarget,
      importance: 2,
    },
    {
      id: "line-03",
      text: `README 重点是“${section.heading}”：${readmeText}`,
      keyword: section.heading,
      visualIntent: "readme-highlight",
      githubTarget: readmeTarget,
      importance: 1,
    },
  ];
  return { schemaVersion: 1, projectName: analysis.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "github-demo", githubUrl: analysis.githubUrl, targetDurationMs: 12000, lines };
}

export function compactScript(analysis: GitHubAnalysis): ScriptDocument {
  const section = firstUsefulSection(analysis);
  return {
    schemaVersion: 1,
    projectName: analysis.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "github-demo",
    githubUrl: analysis.githubUrl,
    targetDurationMs: 12000,
    lines: [
      { id: "line-01", text: `这是 GitHub 项目 ${analysis.name}：${excerpt(analysis.description || "一个开源项目", 18)}。`, keyword: analysis.name, visualIntent: "repo-intro", githubTarget: { kind: "repo-title", text: analysis.name }, importance: 1 },
      { id: "line-02", text: `当前有 ${analysis.stars} 个 Star，${analysis.forks} 个 Fork。`, keyword: `${analysis.stars} Star`, visualIntent: "github-popularity", githubTarget: { kind: "stars", text: String(analysis.stars) }, importance: 2 },
      { id: "line-03", text: `README 重点是“${section.heading}”，继续看这里。`, keyword: section.heading, visualIntent: "readme-highlight", githubTarget: { kind: "readme-text", text: excerpt(section.body, 28) }, importance: 1 },
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

function isIntent(value: unknown): value is VisualIntent {
  return typeof value === "string" && ["repo-intro", "github-popularity", "readme-highlight", "feature", "benchmark", "hardware", "architecture"].includes(value);
}

function validateDocument(value: unknown, analysis: GitHubAnalysis): ScriptDocument {
  if (!value || typeof value !== "object") throw new Error("Script must be an object");
  const raw = value as Record<string, unknown>;
  const lines = raw.lines;
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("Script must contain lines");
  const parsed: ScriptLine[] = lines.map((line, index) => {
    if (!line || typeof line !== "object") throw new Error(`Invalid script line ${index + 1}`);
    const item = line as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.text !== "string" || typeof item.keyword !== "string" || !isIntent(item.visualIntent)) throw new Error(`Invalid script fields at line ${index + 1}`);
    const target = item.githubTarget as TargetRef;
    if (!target || typeof target !== "object" || typeof target.kind !== "string") throw new Error(`Missing GitHub target at line ${index + 1}`);
    return { id: item.id, text: item.text, keyword: item.keyword, visualIntent: item.visualIntent, githubTarget: target, importance: item.importance === 3 ? 3 : item.importance === 2 ? 2 : 1 };
  });
  const requestedDuration = typeof raw.targetDurationMs === "number" ? raw.targetDurationMs : 12000;
  return { schemaVersion: 1, projectName: typeof raw.projectName === "string" ? raw.projectName : analysis.name, githubUrl: analysis.githubUrl, targetDurationMs: Math.min(12000, Math.max(1000, requestedDuration)), lines: parsed };
}

export async function generateScript(analysis: GitHubAnalysis, options: { offline?: boolean } = {}): Promise<ScriptDocument> {
  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (options.offline || !baseUrl || !model) return localScript(analysis);
  const prompt = [
    "Generate a concise Chinese GitHub project video script as JSON only.",
    "Use only facts in the supplied analysis. Never invent benchmarks or hardware claims.",
    "Return {projectName, targetDurationMs, lines}; each line needs id,text,keyword,visualIntent,githubTarget,importance.",
    JSON.stringify(analysis),
  ].join("\n\n");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) throw new Error(`OpenAI-Compatible script request failed (${response.status})`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI-Compatible response contained no message content");
  return validateDocument(extractJson(content), analysis);
}

export { localScript, validateDocument };
