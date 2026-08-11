import { expect, test as base, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CameraSnapshot } from "../../src/game/CameraDirector";
import type { ContestantProjection } from "../../src/game/DontWaveWorld";
import { CROSSING_GREEN_MS, CROSSING_RED_MS, DEATH_MS } from "../../src/simulation/DontWaveSession";
import type { DontWaveState, FireResult } from "../../src/simulation/types";

interface RuntimeFixtures {
  runtimeErrors: string[];
}

interface DontWaveRuntime {
  state(): DontWaveState;
  start(): DontWaveState;
  startGreen(): DontWaveState;
  triggerRed(): DontWaveState;
  advance(milliseconds: number): DontWaveState;
  fire(targetId: string | null): FireResult;
  continueRound(): DontWaveState;
  leaveTower(): DontWaveState;
  beginCrossing(): DontWaveState;
  setPlayerMoving(moving: boolean): DontWaveState;
  restart(seed?: number): DontWaveState;
  fireAtReticle(): boolean;
  projectContestant(id: string): ContestantProjection | null;
  cameraSnapshot(): CameraSnapshot;
}

declare global {
  interface Window {
    __DONT_WAVE__: DontWaveRuntime;
  }
}

const test = base.extend<RuntimeFixtures>({
  runtimeErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
      page.on("requestfailed", (request) => errors.push(`request: ${request.url()} (${request.failure()?.errorText ?? "failed"})`));
      await use(errors);
      expect(errors, "The browser emitted runtime, console, or asset-loading errors.").toEqual([]);
    },
    { auto: true },
  ],
});

const SCREENSHOTS = resolve(process.cwd(), "test-results/screenshots-v0.4-reset");

async function boot(page: Page): Promise<void> {
  await page.goto("?seed=7071&clock=manual", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__DONT_WAVE__));
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-label", /Fixed watchtower view/);
  await expect(page.getByTestId("briefing")).toBeVisible();
  await expect(page.getByRole("heading", { name: "DON'T WAVE" })).toBeVisible();
}

async function advance(page: Page, milliseconds: number): Promise<DontWaveState> {
  const state = await page.evaluate((duration) => window.__DONT_WAVE__.advance(duration), milliseconds);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  return state;
}

async function capture(page: Page, filename: string): Promise<void> {
  await mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOTS, filename), fullPage: true, animations: "disabled" });
}

async function enterHunt(page: Page, touch = false): Promise<void> {
  const start = page.getByTestId("start");
  if (await start.isVisible()) touch ? await start.tap() : await start.click();
  const green = page.getByTestId("green");
  touch ? await green.tap() : await green.click();
  await advance(page, 4_500);
  const red = page.getByTestId("red");
  await expect(red).toBeEnabled();
  touch ? await red.tap() : await red.click();
  await advance(page, 500);
  await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().phase)).toBe("hunt");
}

async function clickProjected(page: Page, pose: "waving" | "still", touch = false): Promise<string> {
  const projection = await page.evaluate((wantedPose) => {
    const state = window.__DONT_WAVE__.state();
    for (const contestant of state.contestants) {
      if (contestant.status !== "active" || contestant.pose !== wantedPose) continue;
      const projected = window.__DONT_WAVE__.projectContestant(contestant.id);
      if (projected?.visible) return projected;
    }
    return null;
  }, pose);
  if (!projection) throw new Error(`No visible ${pose} contestant could be projected.`);
  if (touch) await page.touchscreen.tap(projection.x, projection.y);
  else await page.mouse.click(projection.x, projection.y);
  return projection.id;
}

async function finishEightTurns(page: Page, touch = false): Promise<void> {
  for (let absoluteTurn = 0; absoluteTurn < 8; absoluteTurn += 1) {
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().phase)).toBe("ready");
    const green = page.getByTestId("green");
    touch ? await green.tap() : await green.click();
    await advance(page, 4_500);
    const red = page.getByTestId("red");
    touch ? await red.tap() : await red.click();
    await advance(page, 500 + 5_000 + 3_200);
    if (absoluteTurn === 3) {
      await expect(page.getByTestId("round-break")).toBeVisible();
      const nextRound = page.getByTestId("continue-round");
      touch ? await nextRound.tap() : await nextRound.click();
    }
  }
}

test.describe("desktop reset", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop primary gate.");
    await boot(page);
  });

  test("shows forward motion, a fixed camera, real target penalties, and the five-second lead", async ({ page }) => {
    await page.getByTestId("start").click();
    await page.getByTestId("green").click();
    const before = await page.evaluate(() => ({
      camera: window.__DONT_WAVE__.cameraSnapshot(),
      z: window.__DONT_WAVE__.state().contestants.map((contestant) => contestant.z),
    }));
    await advance(page, 1_000);
    const after = await page.evaluate(() => ({
      camera: window.__DONT_WAVE__.cameraSnapshot(),
      z: window.__DONT_WAVE__.state().contestants.map((contestant) => contestant.z),
    }));
    expect(after.z.every((z, index) => z > (before.z[index] ?? Number.POSITIVE_INFINITY))).toBe(true);
    expect(after.camera).toEqual(before.camera);
    const canvas = page.locator("canvas");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Canvas has no bounds.");
    await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.45);
    expect(await page.evaluate(() => window.__DONT_WAVE__.cameraSnapshot())).toEqual(before.camera);
    await capture(page, "01-forward-green.png");

    await advance(page, 3_500);
    await page.getByTestId("red").click();
    await expect(page.locator("[data-ui='announcement']")).toHaveText("RED LIGHT");
    await advance(page, 500);
    await capture(page, "02-red-wave-still.png");

    const reticle = page.locator("[data-ui='reticle']");
    const reticleXBefore = await page.locator(".dw-shell").evaluate((element) => (
      getComputedStyle(element).getPropertyValue("--reticle-x")
    ));
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await expect(reticle).toBeVisible();
    const reticleXAfter = await page.locator(".dw-shell").evaluate((element) => (
      getComputedStyle(element).getPropertyValue("--reticle-x")
    ));
    expect(reticleXAfter).not.toBe(reticleXBefore);

    const correctId = await clickProjected(page, "waving");
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerScore)).toBe(100);
    expect(await page.evaluate((id) => window.__DONT_WAVE__.state().contestants.find((c) => c.id === id)?.status, correctId)).toBe("evaporated");
    const wrongId = await clickProjected(page, "still");
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerScore)).toBe(0);
    expect(await page.evaluate((id) => window.__DONT_WAVE__.state().contestants.find((c) => c.id === id)?.status, wrongId)).toBe("evaporated");

    await advance(page, 4_999);
    expect(await page.evaluate(() => {
      const state = window.__DONT_WAVE__.state();
      return [state.phase, state.leftScore, state.rightScore];
    })).toEqual(["hunt", 0, 0]);
    await advance(page, 1);
    expect(await page.evaluate(() => window.__DONT_WAVE__.state().phase)).toBe("rivals");
    await advance(page, 350);
    expect(await page.evaluate(() => {
      const state = window.__DONT_WAVE__.state();
      return state.leftScore + state.rightScore;
    })).toBeGreaterThan(0);
    await capture(page, "03-rival-volley.png");
  });

  test("completes two rounds, refreshes the crowd, and performs the fixed death ending", async ({ page }) => {
    await page.getByTestId("start").click();
    const firstVisuals = await page.evaluate(() => window.__DONT_WAVE__.state().contestants.map((c) => c.visual));
    await finishEightTurns(page);
    await expect(page.getByTestId("final-standings")).toBeVisible();
    const state = await page.evaluate(() => window.__DONT_WAVE__.state());
    expect(state.history).toHaveLength(8);
    expect(state.crowdRevision).toBe(2);
    expect(state.contestants.map((contestant) => contestant.visual)).not.toEqual(firstVisuals);
    await page.getByTestId("leave-tower").click();
    await advance(page, 2_200);
    expect((await page.evaluate(() => window.__DONT_WAVE__.cameraSnapshot())).screenUp[1]).toBeGreaterThan(0.9);
    await page.getByTestId("begin-crossing").click();
    await page.locator(".dw-shell").focus();
    await page.keyboard.down("KeyW");
    await advance(page, 1_400);
    await page.keyboard.up("KeyW");
    await advance(page, 2_600);
    expect(await page.evaluate(() => window.__DONT_WAVE__.state().phase)).toBe("crossing-red");
    await advance(page, 650);
    expect((await page.evaluate(() => window.__DONT_WAVE__.cameraSnapshot())).handVisible).toBe(true);
    await capture(page, "04-involuntary-wave.png");
    await advance(page, 450 + 1_400);
    await expect(page.getByTestId("complete")).toBeVisible();
    await expect(page.getByTestId("restart")).toHaveText("PLAY AGAIN");
  });

  test("uses a static fall and fade when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("start").click();
    await finishEightTurns(page);
    await page.getByTestId("leave-tower").click();
    await advance(page, 2_200);
    await page.getByTestId("begin-crossing").click();
    await advance(page, CROSSING_GREEN_MS);
    await advance(page, CROSSING_RED_MS);
    await advance(page, DEATH_MS / 2);
    const camera = await page.evaluate(() => window.__DONT_WAVE__.cameraSnapshot());
    expect(camera.screenUp[1]).toBeGreaterThan(0.9);
  });
});

test.describe("responsive smoke", () => {
  test("keeps the touch loop within a phone-landscape viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "pixel-7-landscape-chromium", "Landscape touch only.");
    await boot(page);
    await enterHunt(page, true);
    await clickProjected(page, "waving", true);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height);
    await capture(page, "05-phone-landscape.png");
  });

  test("keeps quantum claims and external requests out of the portrait build", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "pixel-7-portrait-chromium", "Portrait smoke only.");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await boot(page);
    expect(await page.locator("body").innerText()).not.toMatch(/QPU|quantum|particle|collapse|entangl|circuit/i);
    await expect(page.locator(".dw-orientation")).toBeVisible();
    const origin = new URL(page.url()).origin;
    expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
  });
});
