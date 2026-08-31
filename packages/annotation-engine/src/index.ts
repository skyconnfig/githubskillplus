import type { AnnotationType, BoundingBox } from "../../../packages/shared/src/types.js";

export interface AnnotationGeometry {
  type: AnnotationType;
  path?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function random(seed: { value: number }): number {
  seed.value = (Math.imul(seed.value ^ (seed.value >>> 16), 2246822519) + 3266489917) >>> 0;
  return seed.value / 4294967296;
}

function circlePath(box: BoundingBox, id: string): string {
  const seed = { value: hash(id) };
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 10;
    const radiusX = box.width / 2 + (random(seed) - 0.5) * 10;
    const radiusY = box.height / 2 + (random(seed) - 0.5) * 10;
    return { x: box.x + box.width / 2 + Math.cos(angle) * radiusX, y: box.y + box.height / 2 + Math.sin(angle) * radiusY };
  });
  const first = points[0]!;
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const previous = points[index - 1]!;
    const controlX = (previous.x + point.x) / 2 + (random(seed) - 0.5) * 8;
    const controlY = (previous.y + point.y) / 2 + (random(seed) - 0.5) * 8;
    path += ` Q ${controlX.toFixed(2)} ${controlY.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  path += ` Q ${(points[9]!.x + first.x) / 2} ${(points[9]!.y + first.y) / 2} ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  return path;
}

function underlinePath(box: BoundingBox, id: string): string {
  const seed = { value: hash(id) };
  const y = box.y + box.height + 8;
  const midX = box.x + box.width / 2;
  const midY = y + (random(seed) - 0.5) * 8;
  return `M ${box.x.toFixed(2)} ${y.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${(box.x + box.width).toFixed(2)} ${(y + (random(seed) - 0.5) * 5).toFixed(2)}`;
}

function boxPath(box: BoundingBox, id: string): string {
  const seed = { value: hash(id) };
  const jitter = () => (random(seed) - 0.5) * 8;
  const x = box.x - 10;
  const y = box.y - 10;
  const w = box.width + 20;
  const h = box.height + 20;
  return `M ${x + jitter()} ${y + jitter()} L ${x + w + jitter()} ${y + jitter()} L ${x + w + jitter()} ${y + h + jitter()} L ${x + jitter()} ${y + h + jitter()} Z`;
}

export function createAnnotationGeometry(type: AnnotationType, box: BoundingBox, id: string): AnnotationGeometry {
  if (type === "hand-circle") return { type, path: circlePath(box, id), x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 };
  if (type === "hand-underline") return { type, path: underlinePath(box, id), x: box.x, y: box.y, width: box.width, height: box.height + 20 };
  if (type === "hand-box") return { type, path: boxPath(box, id), x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 };
  if (type === "arrow") return { type, path: `M ${box.x - 90} ${box.y - 60} Q ${box.x - 45} ${box.y - 35} ${box.x} ${box.y} M ${box.x - 18} ${box.y - 4} L ${box.x} ${box.y} L ${box.x - 5} ${box.y - 18}`, x: box.x - 100, y: box.y - 70, width: box.width + 100, height: box.height + 70 };
  return { type, x: box.x, y: box.y, width: box.width, height: box.height };
}
