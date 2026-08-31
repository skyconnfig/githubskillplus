import type { GitHubAnalysis, ReadmeSection } from "../../../packages/shared/src/types.js";

interface GitHubRepositoryResponse {
  name?: string;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  watchers_count?: number;
  license?: { spdx_id?: string | null } | null;
  language?: string | null;
  topics?: string[];
  default_branch?: string;
}

interface GitHubReadmeResponse {
  download_url?: string | null;
  content?: string;
  encoding?: string;
}

function parseGitHubUrl(input: string): { owner: string; name: string; canonical: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid GitHub URL: ${input}`);
  }
  if (url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only github.com repository URLs are supported");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("GitHub URL must look like https://github.com/owner/repo");
  const owner = parts[0];
  const name = parts[1]?.replace(/\.git$/, "");
  if (!owner || !name) throw new Error("GitHub URL is missing owner or repository name");
  return { owner, name, canonical: `https://github.com/${owner}/${name}` };
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-video-studio/0.1",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${url}`);
  return (await response.json()) as T;
}

async function getReadme(owner: string, name: string, branch: string, token?: string): Promise<string> {
  const api = await getJson<GitHubReadmeResponse>(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`,
    token,
  );
  if (api.content && api.encoding === "base64") {
    return Buffer.from(api.content.replace(/\n/g, ""), "base64").toString("utf8");
  }
  const rawUrl = api.download_url ?? `https://raw.githubusercontent.com/${owner}/${name}/${branch}/README.md`;
  const response = await fetch(rawUrl, { headers: { "User-Agent": "github-video-studio/0.1" } });
  if (!response.ok) throw new Error(`README request failed (${response.status}): ${rawUrl}`);
  return await response.text();
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryForHeading(heading: string): ReadmeSection["category"] {
  const value = heading.toLowerCase();
  if (/feature|capabilit/.test(value)) return "features";
  if (/benchmark|performance|speed|result/.test(value)) return "benchmark";
  if (/install|getting started|setup/.test(value)) return "installation";
  if (/usage|quickstart|quick start|example/.test(value)) return "usage";
  if (/hardware|gpu|cpu|requirement|memory/.test(value)) return "hardware";
  if (/demo|showcase|screenshot/.test(value)) return "demo";
  return "other";
}

function parseReadme(readme: string): {
  headings: Array<{ heading: string; level: number }>;
  sections: ReadmeSection[];
  images: Array<{ alt: string; url: string }>;
} {
  const headingMatches = [...readme.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)];
  const headings = headingMatches.map((match) => ({ heading: cleanMarkdown(match[2] ?? ""), level: match[1]?.length ?? 1 }));
  const sections: ReadmeSection[] = headingMatches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = headingMatches[index + 1]?.index ?? readme.length;
    const heading = cleanMarkdown(match[2] ?? "");
    return {
      heading,
      level: match[1]?.length ?? 1,
      body: readme.slice(start, end).trim(),
      category: categoryForHeading(heading),
    };
  });
  const images = [...readme.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((match) => ({
    alt: match[1] ?? "",
    url: match[2] ?? "",
  }));
  return { headings, sections, images };
}

export async function analyzeRepository(input: string, token = process.env.GITHUB_TOKEN): Promise<GitHubAnalysis> {
  const parsed = parseGitHubUrl(input);
  const repoUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`;
  const repo = await getJson<GitHubRepositoryResponse>(repoUrl, token);
  const branch = repo.default_branch ?? "main";
  const warnings: string[] = [];
  let readme = "";
  try {
    readme = await getReadme(parsed.owner, parsed.name, branch, token);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  const parsedReadme = parseReadme(readme);
  let languages: Record<string, number> = {};
  try {
    languages = await getJson<Record<string, number>>(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}/languages`,
      token,
    );
  } catch (error) {
    warnings.push(`Languages unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    schemaVersion: 1,
    analyzedAt: new Date().toISOString(),
    githubUrl: parsed.canonical,
    owner: parsed.owner,
    name: repo.name ?? parsed.name,
    fullName: repo.full_name ?? `${parsed.owner}/${parsed.name}`,
    title: repo.name ?? parsed.name,
    description: repo.description ?? "",
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    watchers: repo.watchers_count ?? 0,
    license: repo.license?.spdx_id ?? null,
    languages,
    topics: repo.topics ?? [],
    defaultBranch: branch,
    readme,
    readmeHeadings: parsedReadme.headings,
    sections: parsedReadme.sections,
    images: parsedReadme.images,
    sources: [parsed.canonical, repoUrl, `https://raw.githubusercontent.com/${parsed.owner}/${parsed.name}/${branch}/README.md`],
    warnings,
  };
}

export { parseGitHubUrl };
