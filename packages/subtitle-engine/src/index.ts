import type { AudioTimeline } from "../../../packages/shared/src/types.js";

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function wrapCaption(text: string, maxChars = 20): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= maxChars) return value;
  const candidates = ["，", "。", "！", "？", "：", ";", ",", " "];
  const openingMarks = new Set(["“", "（", "《", "【", "「"]);
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > maxChars) {
    const limit = Math.min(maxChars, remaining.length);
    const minBreak = Math.max(4, Math.ceil(limit / 2));
    let breakAt = -1;
    for (let index = limit; index >= minBreak; index -= 1) {
      if (candidates.includes(remaining[index - 1] ?? "")) {
        breakAt = index;
        break;
      }
      if (openingMarks.has(remaining[index] ?? "")) {
        breakAt = index;
        break;
      }
    }
    if (breakAt < 0) breakAt = limit;
    while (breakAt > 1 && /[A-Za-z0-9]/.test(remaining[breakAt - 1] ?? "") && /[A-Za-z0-9]/.test(remaining[breakAt] ?? "")) breakAt -= 1;
    if (breakAt < 1) breakAt = limit;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining.length > 0) lines.push(remaining);
  return lines.join("\n");
}

export function generateSrt(timeline: AudioTimeline): string {
  return timeline.segments.map((segment, index) => `${index + 1}\n${timestamp(segment.startMs)} --> ${timestamp(segment.endMs)}\n${wrapCaption(segment.text)}\n`).join("\n");
}
