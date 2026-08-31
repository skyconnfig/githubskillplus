import { describe, expect, it } from "vitest";
import { buildWordTimeline } from "../packages/alignment-engine/src/index.js";
import type { AudioTimeline } from "../packages/shared/src/types.js";

describe("alignment engine", () => {
  it("creates deterministic weighted word timing inside each sentence", async () => {
    const timeline: AudioTimeline = { schemaVersion: 1, audioPath: "voice.wav", totalDurationMs: 1000, segments: [{ lineId: "line-01", text: "看 39.3 tok/s。", audioPath: "line.wav", startMs: 0, durationMs: 1000, endMs: 1000 }] };
    const first = await buildWordTimeline(timeline);
    const second = await buildWordTimeline(timeline);
    expect(first).toEqual(second);
    expect(first.words.map((word) => word.text)).toEqual(["看", "39.3", "tok/s", "。"]);
    expect(first.words[0]!.startMs).toBe(0);
    expect(first.words.at(-1)!.endMs).toBe(1000);
    expect(first.words.every((word) => word.endMs > word.startMs)).toBe(true);
  });
});
