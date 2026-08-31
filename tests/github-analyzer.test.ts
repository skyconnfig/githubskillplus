import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "../packages/github-analyzer/src/index.js";

describe("GitHub analyzer", () => {
  it("canonicalizes repository URLs without treating query text as repo data", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo?utm_source=test")).toEqual({ owner: "owner", name: "repo", canonical: "https://github.com/owner/repo" });
  });
});
