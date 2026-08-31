import { chromium, type Locator, type Page } from "playwright";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioTimeline, CaptureAction, CaptureEvent, CaptureManifest, DirectorPlan, LocatedTarget, PointerSample, ScrollSample, StoryboardDocument, StoryboardScene, TargetRef, TargetSample, TargetTrack } from "../../../packages/shared/src/types.js";

export interface CaptureOptions {
  directorPlan?: DirectorPlan;
  samplingHz?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function locatorFor(page: Page, target: TargetRef): { locator: Locator; selector: string } {
  if (target.kind === "repo-title") return { locator: page.getByRole("link", { name: target.text, exact: true }).first(), selector: `role=link[name=${target.text}]` };
  if (target.kind === "stars") return { locator: page.getByRole("link", { name: /Star/i }).first(), selector: "role=link[name=/Star/i]" };
  if (target.kind === "readme-heading") return { locator: page.getByRole("heading", { name: target.heading, exact: false }).first(), selector: `role=heading[name=${target.heading}]` };
  if (target.kind === "readme-text") {
    const needle = target.text.replace(/…$/, "").trim();
    return { locator: page.getByText(needle, { exact: false }).first(), selector: `text=${needle}` };
  }
  if (target.kind === "image") return { locator: page.locator(`img[alt*="${escapeRegExp(target.alt ?? "")}"]`).first(), selector: `img[alt*="${target.alt ?? ""}"]` };
  return { locator: page.locator("pre code").filter({ hasText: target.text ?? "" }).first(), selector: "pre code" };
}

async function fallbackLocator(page: Page, target: TargetRef): Promise<{ locator: Locator; selector: string }> {
  const primary = locatorFor(page, target);
  if (await primary.locator.count() > 0) return primary;
  if (target.kind === "repo-title") return { locator: page.locator("h1").filter({ hasText: target.text }).first(), selector: "h1" };
  if (target.kind === "stars") return { locator: page.getByText(/Star/i).first(), selector: "text=/Star/i" };
  if (target.kind === "readme-text") {
    const needle = target.text.replace(/…$/, "").trim();
    return { locator: page.getByText(new RegExp(escapeRegExp(needle), "i")).first(), selector: `regex=${needle}` };
  }
  return primary;
}

export async function locateTarget(page: Page, target: TargetRef, settleMs = 350): Promise<LocatedTarget> {
  const resolved = await fallbackLocator(page, target);
  if (await resolved.locator.count() === 0) throw new Error(`Target not found: ${JSON.stringify(target)}`);
  await resolved.locator.scrollIntoViewIfNeeded({ timeout: 15000 });
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  const box = target.kind === "repo-title"
    ? await resolved.locator.evaluate((element) => {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    })
    : await resolved.locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) throw new Error(`Target has no visible bounding box: ${JSON.stringify(target)}`);
  const text = (await resolved.locator.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  return { target, selector: resolved.selector, text, boundingBox: box, viewportWidth: page.viewportSize()?.width ?? 1440, viewportHeight: page.viewportSize()?.height ?? 1080, scrollY: await page.evaluate(() => window.scrollY), pageUrl: page.url() };
}

function segmentDuration(timeline: AudioTimeline, lineId: string, fallback: number): { startMs: number; durationMs: number; endMs: number } {
  const segment = timeline.segments.find((item) => item.lineId === lineId);
  return segment ? { startMs: segment.startMs, durationMs: segment.durationMs, endMs: segment.endMs } : { startMs: 0, durationMs: fallback, endMs: fallback };
}

function easeInOut(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function bezier(from: { x: number; y: number }, to: { x: number; y: number }, progress: number): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control = { x: from.x + dx * 0.5 - dy * 0.08, y: from.y + dy * 0.5 + dx * 0.08 };
  const t = easeInOut(progress);
  return { x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x, y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y };
}

interface RecorderState {
  pointer: PointerSample[];
  scroll: ScrollSample[];
  targets: Map<string, TargetSample[]>;
  locatedTargets: Map<string, LocatedTarget>;
  cursor: { x: number; y: number };
  viewport: { width: number; height: number };
  sampleMs: number;
  timelineStartedAt: number;
}

async function waitForTimeline(state: RecorderState, timeMs: number): Promise<void> {
  const remaining = state.timelineStartedAt + timeMs - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function sampleTarget(page: Page, targetId: string, target: TargetRef, state: RecorderState, timeMs: number): Promise<void> {
  const resolved = await fallbackLocator(page, target);
  const box = target.kind === "repo-title"
    ? await resolved.locator.evaluate((element) => {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    }).catch(() => null)
    : await resolved.locator.boundingBox().catch(() => null);
  const sample: TargetSample = box && box.width > 0 && box.height > 0 ? { timeMs, ...box, visible: true } : { timeMs, x: 0, y: 0, width: 0, height: 0, visible: false };
  const samples = state.targets.get(targetId) ?? [];
  samples.push(sample);
  state.targets.set(targetId, samples);
}

function addScrollSample(page: Page, state: RecorderState, timeMs: number): Promise<void> {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })).then((position) => {
    state.scroll.push({ timeMs, scrollX: position.x, scrollY: position.y });
  });
}

async function moveCursor(page: Page, target: LocatedTarget, state: RecorderState, startTimeMs: number, durationMs: number): Promise<number> {
  const end = { x: target.boundingBox.x + target.boundingBox.width / 2, y: target.boundingBox.y + target.boundingBox.height / 2 };
  const steps = Math.max(2, Math.min(12, Math.ceil(durationMs / 100)));
  const from = state.cursor;
  for (let index = 1; index <= steps; index += 1) {
    const point = bezier(from, end, index / steps);
    await page.mouse.move(point.x, point.y);
    state.pointer.push({ timeMs: Math.round(startTimeMs + durationMs * index / steps), x: point.x, y: point.y, event: "move" });
    await waitForTimeline(state, startTimeMs + durationMs * index / steps);
  }
  state.cursor = end;
  return durationMs;
}

async function smoothScrollTo(page: Page, target: LocatedTarget, state: RecorderState, startTimeMs: number, durationMs: number): Promise<number> {
  const current = await page.evaluate(() => window.scrollY);
  const destination = await page.evaluate(({ targetY, viewportHeight }) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(max, targetY + window.scrollY - viewportHeight * 0.32));
  }, { targetY: target.boundingBox.y, viewportHeight: state.viewport.height });
  await addScrollSample(page, state, startTimeMs);
  await page.evaluate(({ destination, durationMs }) => {
    window.scrollTo({ top: destination, behavior: "smooth" });
    return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  }, { destination, durationMs });
  await addScrollSample(page, state, Math.round(startTimeMs + durationMs));
  return durationMs;
}

async function smoothScrollBy(page: Page, state: RecorderState, startTimeMs: number, deltaY: number, durationMs: number): Promise<number> {
  const current = await page.evaluate(() => window.scrollY);
  const destination = await page.evaluate(({ currentY, delta }) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(max, currentY + delta));
  }, { currentY: current, delta: deltaY });
  await addScrollSample(page, state, startTimeMs);
  await page.evaluate(({ destination, durationMs }) => {
    window.scrollTo({ top: destination, behavior: "smooth" });
    return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  }, { destination, durationMs });
  await addScrollSample(page, state, Math.round(startTimeMs + durationMs));
  return durationMs;
}

async function waitWithSamples(page: Page, scene: StoryboardScene, target: TargetRef, state: RecorderState, startTimeMs: number, durationMs: number): Promise<number> {
  const steps = Math.max(1, Math.ceil(durationMs / 100));
  for (let index = 0; index < steps; index += 1) {
    const timeMs = Math.min(startTimeMs + durationMs, Math.round(startTimeMs + durationMs * index / steps));
    await sampleTarget(page, scene.targetId, target, state, timeMs);
    await addScrollSample(page, state, timeMs);
    await waitForTimeline(state, timeMs);
  }
  await sampleTarget(page, scene.targetId, target, state, startTimeMs + durationMs);
  return durationMs;
}

async function targetForId(page: Page, storyboard: StoryboardDocument, targetId: string, state: RecorderState): Promise<{ scene: StoryboardScene; located: LocatedTarget }> {
  const scene = storyboard.scenes.find((item) => item.targetId === targetId) ?? storyboard.scenes.find((item) => item.id === targetId);
  if (!scene) throw new Error(`Director target is not present in storyboard: ${targetId}`);
  return { scene, located: state.locatedTargets.get(targetId) ?? await locateTarget(page, scene.source.target, 0) };
}

function targetNeedsScroll(target: LocatedTarget, viewport: { width: number; height: number }): boolean {
  const topSafe = viewport.height * 0.2;
  const bottomSafe = viewport.height * 0.8;
  const top = target.boundingBox.y;
  const bottom = top + target.boundingBox.height;
  return top < topSafe || bottom > bottomSafe;
}

async function runCaptureAction(page: Page, storyboard: StoryboardDocument, action: CaptureAction, state: RecorderState, startTimeMs: number): Promise<number> {
  if (action.type === "goto") { if (page.url() !== action.url) await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 60000 }); return 0; }
  if (action.type === "wait") { await waitForTimeline(state, startTimeMs + action.durationMs); return action.durationMs; }
  if (action.type === "scroll-by") return smoothScrollBy(page, state, startTimeMs, action.y, action.durationMs ?? 600);
  const { scene, located } = await targetForId(page, storyboard, "targetId" in action ? action.targetId : "", state);
  if (action.type === "scroll-to") {
    // locateTarget already makes the element visible. Do not move a target
    // that is already in the readable middle band: a second scroll here can
    // desynchronise the recorded page from the camera chain.
    if (!targetNeedsScroll(located, state.viewport)) return 0;
    return smoothScrollTo(page, located, state, startTimeMs, action.durationMs ?? 600);
  }
  if (action.type === "cursor-move") return moveCursor(page, located, state, startTimeMs, action.durationMs ?? 420);
  if (action.type === "hover") return moveCursor(page, located, state, startTimeMs, 180);
  if (action.type === "click") {
    const duration = await moveCursor(page, located, state, startTimeMs, 320);
    await page.mouse.down();
    state.pointer.push({ timeMs: startTimeMs + duration, x: state.cursor.x, y: state.cursor.y, event: "down", button: "left" });
    await page.mouse.up();
    state.pointer.push({ timeMs: startTimeMs + duration + 35, x: state.cursor.x, y: state.cursor.y, event: "up", button: "left" });
    state.pointer.push({ timeMs: startTimeMs + duration + 35, x: state.cursor.x, y: state.cursor.y, event: "click", button: "left" });
    return duration + 35;
  }
  void scene;
  return 0;
}

export async function captureStoryboard(storyboard: StoryboardDocument, timeline: AudioTimeline, outputDir: string, options: CaptureOptions = {}): Promise<CaptureManifest> {
  await mkdir(outputDir, { recursive: true });
  const screenshotDir = join(outputDir, "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const recordingDir = join(outputDir, ".recording");
  await mkdir(recordingDir, { recursive: true });
  const recordingStartedAt = Date.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: recordingDir, size: { width: 1440, height: 1080 } } });
  const page = await context.newPage();
  const sampleHz = Math.max(30, Math.min(60, options.samplingHz ?? 60));
  const state: RecorderState = { pointer: [], scroll: [], targets: new Map(), locatedTargets: new Map(), cursor: { x: 720, y: 540 }, viewport: { width: 1440, height: 1080 }, sampleMs: 1000 / sampleHz, timelineStartedAt: 0 };
  try {
    await page.goto(storyboard.project.githubUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1600);
    const captureStartedAt = Date.now();
    state.timelineStartedAt = captureStartedAt;
    const events: CaptureEvent[] = [];
    const screenshots: Record<string, string> = {};
    const plans = new Map((options.directorPlan?.beats ?? []).map((beat) => [beat.sceneId, beat]));
    for (const [sceneIndex, scene] of storyboard.scenes.entries()) {
      const timing = segmentDuration(timeline, scene.lineId, Math.max(1000, scene.endMs - scene.startMs));
      const sceneStart = timing.startMs;
      // Let the camera leave the previous target before Playwright moves the
      // page to the next one. Otherwise scrollIntoViewIfNeeded changes the
      // page under the previous zoom pose and records a mostly blank frame.
      const preRollMs = sceneIndex === 0 ? 0 : Math.min(520, Math.max(260, Math.floor(timing.durationMs * 0.13)));
      await waitForTimeline(state, sceneStart + preRollMs);
      const target = await locateTarget(page, scene.source.target, 0);
      state.locatedTargets.set(scene.targetId, target);
      const beat = plans.get(scene.id);
      let elapsed = preRollMs;
      const captureActions = beat?.actions.filter((action): action is CaptureAction => ["goto", "scroll-to", "scroll-by", "cursor-move", "hover", "click", "wait"].includes(action.type)) ?? [{ type: "scroll-to", targetId: scene.targetId, durationMs: 520 }, { type: "cursor-move", targetId: scene.targetId, durationMs: 420 }];
      for (const action of captureActions) elapsed += await runCaptureAction(page, storyboard, action, state, sceneStart + elapsed);
      await sampleTarget(page, scene.targetId, scene.source.target, state, sceneStart + elapsed);
      const centerX = target.boundingBox.x + target.boundingBox.width / 2;
      const centerY = target.boundingBox.y + target.boundingBox.height / 2;
      const localPointer = state.pointer.filter((sample) => sample.timeMs >= sceneStart && sample.timeMs <= timing.endMs).map((sample) => ({ ...sample, timeMs: sample.timeMs - sceneStart }));
      const screenshotPath = join(screenshotDir, `${scene.id}.png`);
      await page.screenshot({ path: screenshotPath });
      screenshots[scene.id] = screenshotPath;
      events.push({ ...target, sceneId: scene.id, lineId: scene.lineId, targetId: scene.targetId, timestampMs: sceneStart, durationMs: timing.durationMs, cursorTrack: localPointer.length > 0 ? localPointer : [{ timeMs: 0, x: state.cursor.x, y: state.cursor.y, event: "idle" }] });
      const remaining = Math.max(0, timing.durationMs - elapsed);
      if (remaining > 0) await waitWithSamples(page, scene, scene.source.target, state, sceneStart + elapsed, remaining);
    }
    const video = page.video();
    if (!video) throw new Error("Playwright video recorder was not created");
    const sourcePath = await video.path();
    await context.close();
    await browser.close();
    const videoPath = join(outputDir, "capture.webm");
    await rm(videoPath, { force: true });
    await rename(sourcePath, videoPath);
    const targetTracks: TargetTrack[] = [...state.targets.entries()].map(([targetId, samples]) => ({ targetId, samples }));
    const pointerTrack = state.pointer.sort((a, b) => a.timeMs - b.timeMs);
    const scrollTrack = state.scroll.sort((a, b) => a.timeMs - b.timeMs);
    await Promise.all([
      writeFile(join(outputDir, "pointer-track.json"), JSON.stringify(pointerTrack, null, 2), "utf8"),
      writeFile(join(outputDir, "scroll-track.json"), JSON.stringify(scrollTrack, null, 2), "utf8"),
      writeFile(join(outputDir, "target-tracks.json"), JSON.stringify(targetTracks, null, 2), "utf8"),
    ]);
    const manifest: CaptureManifest = { schemaVersion: 1, createdAt: new Date().toISOString(), videoPath, videoStartMs: Math.max(0, captureStartedAt - recordingStartedAt), viewport: { width: 1440, height: 1080 }, screenshots, events, pointerTrack, scrollTrack, targetTracks };
    await writeFile(join(outputDir, "capture-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  } catch (error) {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw error;
  }
}
