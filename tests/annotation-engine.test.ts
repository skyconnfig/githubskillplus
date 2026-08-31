import { describe, expect, it } from "vitest";
import { createAnnotationGeometry } from "../packages/annotation-engine/src/index.js";

describe("annotation engine", () => {
  const box = { x: 100, y: 200, width: 240, height: 70 };

  it("creates deterministic hand paths from annotation id", () => {
    const first = createAnnotationGeometry("hand-circle", box, "scene-001-title");
    const second = createAnnotationGeometry("hand-circle", box, "scene-001-title");
    expect(first.path).toBe(second.path);
    expect(first.path).toContain("Q");
    expect((first.path?.match(/ Q /g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it("changes jitter when annotation id changes", () => {
    const first = createAnnotationGeometry("hand-underline", box, "one");
    const second = createAnnotationGeometry("hand-underline", box, "two");
    expect(first.path).not.toBe(second.path);
  });
});
