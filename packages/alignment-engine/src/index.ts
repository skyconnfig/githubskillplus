import type { AudioSegment, AudioTimeline, WordTimeline, WordTiming } from "../../../packages/shared/src/types.js";

export interface AlignmentProvider {
  readonly name: string;
  align(segment: AudioSegment): Promise<WordTiming[]>;
}

function tokenize(text: string): string[] {
  return text.match(/[\p{Script=Han}]|[A-Za-z]+(?:[./_-][A-Za-z0-9]+)*|\d+(?:\.\d+)?(?:[A-Za-z%/]+)?|[^\s]/gu) ?? [];
}

function weight(token: string): number {
  if (/^[，。！？；：、“”‘’（）,.!?;:'"()[\]]$/.test(token)) return 0.35;
  if (/^[A-Za-z0-9]/.test(token)) return Math.max(1, token.length * 0.68);
  return 1;
}

export class WeightedAlignmentProvider implements AlignmentProvider {
  readonly name = "weighted-character-approximation";

  async align(segment: AudioSegment): Promise<WordTiming[]> {
    const tokens = tokenize(segment.text);
    if (tokens.length === 0) return [];
    const totalWeight = tokens.reduce((sum, token) => sum + weight(token), 0);
    let cursor = segment.startMs;
    return tokens.map((token, index) => {
      const duration = index === tokens.length - 1 ? segment.endMs - cursor : Math.max(1, Math.round(segment.durationMs * weight(token) / totalWeight));
      const word: WordTiming = { id: `${segment.lineId}-word-${String(index + 1).padStart(3, "0")}`, lineId: segment.lineId, text: token, startMs: cursor, endMs: Math.min(segment.endMs, cursor + duration) };
      cursor = word.endMs;
      return word;
    });
  }
}

export async function buildWordTimeline(audioTimeline: AudioTimeline, provider: AlignmentProvider = new WeightedAlignmentProvider()): Promise<WordTimeline> {
  const words: WordTiming[] = [];
  for (const segment of audioTimeline.segments) words.push(...await provider.align(segment));
  return { schemaVersion: 1, words };
}
