import { chromium, type Locator, type Page } from "playwright";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioTimeline, CaptureEvent, CaptureManifest, LocatedTarget, StoryboardDocument, TargetRef } from "../../../packages/shared/src/types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function locatorFor(page: Page, target: TargetRef): { locator: Locator; selector: string } {
  if (target.kind === "repo-title") return { locator: page.getByRole("heading", { name: target.text, exact: false }).first(), selector: `role=heading[name=${target.text}]` };
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

async function locateTarget(page: Page, target: TargetRef): Promise<LocatedTarget> {
  const resolved = await fallbackLocator(page, target);
  if (await resolved.locator.count() === 0) throw new Error(`Target not found: ${JSON.stringify(target)}`);
  await resolved.locator.scrollIntoViewIfNeeded({ timeout: 15000 });
  await page.waitForTimeout(350);
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

function segmentDuration(timeline: AudioTimeline, lineId: string, fallback: number): { startMs: number; durationMs: number } {
  const segment = timeline.segments.find((item) => item.lineId === lineId);
  return segment ? { startMs: segment.startMs, durationMs: segment.durationMs } : { startMs: 0, durationMs: fallback };
}

export async function captureStoryboard(storyboard: StoryboardDocument, timeline: AudioTimeline, outputDir: string): Promise<CaptureManifest> {
  await mkdir(outputDir, { recursive: true });
  const screenshotDir = join(outputDir, "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const recordingDir = join(outputDir, ".recording");
  await mkdir(recordingDir, { recursive: true });
  const recordingStartedAt = Date.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: recordingDir, size: { width: 1440, height: 1080 } } });
  const page = await context.newPage();
  try {
    await page.goto(storyboard.project.githubUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1600);
    const captureStartedAt = Date.now();
    const events: CaptureEvent[] = [];
    const screenshots: Record<string, string> = {};
    let previousCursor = { x: 720, y: 540 };
    for (const scene of storyboard.scenes) {
      const timing = segmentDuration(timeline, scene.lineId, 3000);
      const target = await locateTarget(page, scene.source.target);
      const centerX = target.boundingBox.x + target.boundingBox.width / 2;
      const centerY = target.boundingBox.y + target.boundingBox.height / 2;
      await page.mouse.move(centerX, centerY, { steps: 24 });
      const track = [{ timeMs: 0, x: previousCursor.x, y: previousCursor.y }, { timeMs: 220, x: centerX, y: centerY }];
      const screenshotPath = join(screenshotDir, `${scene.id}.png`);
      await page.screenshot({ path: screenshotPath });
      screenshots[scene.id] = screenshotPath;
      events.push({ ...target, sceneId: scene.id, lineId: scene.lineId, timestampMs: timing.startMs, durationMs: timing.durationMs, cursorTrack: track });
      previousCursor = { x: centerX, y: centerY };
      await page.waitForTimeout(Math.max(350, timing.durationMs));
    }
    const video = page.video();
    if (!video) throw new Error("Playwright video recorder was not created");
    const sourcePath = await video.path();
    await context.close();
    await browser.close();
    const videoPath = join(outputDir, "capture.webm");
    await rm(videoPath, { force: true });
    await rename(sourcePath, videoPath);
    const manifest: CaptureManifest = { schemaVersion: 1, createdAt: new Date().toISOString(), videoPath, videoStartMs: Math.max(0, captureStartedAt - recordingStartedAt), viewport: { width: 1440, height: 1080 }, screenshots, events };
    await writeFile(join(outputDir, "capture-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  } catch (error) {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw error;
  }
}
