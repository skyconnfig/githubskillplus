import { describe, expect, it } from "vitest";
import { generateSrt, wrapCaption } from "../packages/subtitle-engine/src/index.js";

describe("subtitle timing", () => {
  it("uses measured segment boundaries", () => {
    const srt = generateSrt({ schemaVersion: 1, audioPath: "voice.wav", totalDurationMs: 3000, segments: [{ lineId: "line-01", text: "项目介绍", audioPath: "1.wav", startMs: 0, durationMs: 1250, endMs: 1250 }, { lineId: "line-02", text: "Star 数据", audioPath: "2.wav", startMs: 1250, durationMs: 1750, endMs: 3000 }] });
    expect(srt).toContain("00:00:00,000 --> 00:00:01,250");
    expect(srt).toContain("00:00:01,250 --> 00:00:03,000");
  });

  it("wraps long Chinese captions into at most two lines", () => {
    expect(wrapCaption("这是一个需要被拆成两行的较长字幕内容", 10).split("\n")).toHaveLength(2);
  });

  it("keeps mixed GitHub captions readable on both lines", () => {
    const lines = wrapCaption("README 重点是“Ultrademo”，继续看这里。" ).split("\n");
    expect(lines.every((line) => line.length <= 20)).toBe(true);
    expect(lines.some((line) => line.includes("Ultrademo"))).toBe(true);
    expect(lines.join("")).toBe("README 重点是“Ultrademo”，继续看这里。");
  });
});
