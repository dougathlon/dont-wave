import { expect, test as base, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { DontWaveState, ZapCreatureResult } from "../../src/simulation/types";

interface RuntimeFixtures {
  runtimeErrors: string[];
}

interface DontWaveRuntime {
  state(): DontWaveState;
  start(): DontWaveState;
  startGreen(): DontWaveState;
  triggerRed(): DontWaveState;
  advance(milliseconds: number): DontWaveState;
  zapCreature(creatureId: string): ZapCreatureResult;
  registerMiss(): DontWaveState;
  continueRound(): DontWaveState;
  beginCrossing(): DontWaveState;
  setPlayerMoving(moving: boolean): DontWaveState;
  togglePause(): DontWaveState;
  restart(seed?: number): DontWaveState;
  fireAtReticle(): boolean;
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
      page.on("requestfailed", (request) => {
        errors.push(`request: ${request.url()} (${request.failure()?.errorText ?? "failed"})`);
      });
      await use(errors);
      expect(errors, "The browser emitted runtime, console, or asset-loading errors.").toEqual([]);
    },
    { auto: true },
  ],
});

const SCREENSHOT_DIRECTORY = resolve(process.cwd(), "test-results/screenshots-v0.2");

async function boot(page: Page): Promise<void> {
  await page.goto("?seed=7071", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__DONT_WAVE__));
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-label", "Don't Wave watchtower view over the civic playground");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  await expect(page.getByRole("heading", { name: "DON'T WAVE" })).toBeVisible();
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds?.width ?? 0).toBeGreaterThan(300);
  expect(canvasBounds?.height ?? 0).toBeGreaterThan(240);
}

async function capture(page: Page, filename: string): Promise<void> {
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({
    path: resolve(SCREENSHOT_DIRECTORY, filename),
    fullPage: true,
    animations: "disabled",
  });
}

async function advance(page: Page, milliseconds: number): Promise<DontWaveState> {
  return page.evaluate((duration) => window.__DONT_WAVE__.advance(duration), milliseconds);
}

async function aimAndActivateVisibleWaver(page: Page, activation: "mouse" | "touch" = "mouse"): Promise<void> {
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas has no clickable bounds.");
  const reticle = page.locator("[data-ui='reticle']");
  for (let yStep = 3; yStep <= 17; yStep += 1) {
    for (let xStep = 2; xStep <= 18; xStep += 1) {
      const x = bounds.x + bounds.width * (xStep / 20);
      const y = bounds.y + bounds.height * (yStep / 20);
      await page.mouse.move(x, y);
      if (await reticle.getAttribute("data-can-zap") === "true") {
        const before = await page.evaluate(() => window.__DONT_WAVE__.state().playerHits);
        if (activation === "touch") await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await expect(page.locator(".dw-shell")).toHaveClass(/is-hit/);
        await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerHits)).toBe(before + 1);
        return;
      }
    }
  }
  throw new Error("Could not aim at any rendered waving target.");
}

async function activateControl(page: Page, testId: string, touch: boolean): Promise<void> {
  const control = page.getByTestId(testId);
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  if (touch) await control.tap();
  else await control.click();
}

async function useCrossingControl(page: Page, touch: boolean): Promise<void> {
  const move = page.getByTestId("move");
  await expect(move).toBeVisible();
  await expect(move).toBeEnabled();

  if (!touch) {
    await page.locator(".dw-shell").focus();
    await page.keyboard.down("KeyW");
    await page.keyboard.down("Space");
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerMoving)).toBe(true);
    await page.keyboard.up("KeyW");
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerMoving)).toBe(true);
    await advance(page, 1_400);
    await page.keyboard.up("Space");
  } else {
    const bounds = await move.boundingBox();
    if (!bounds) throw new Error("Crossing control has no touchable bounds.");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const client = await page.context().newCDPSession(page);
    try {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
      });
      await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerMoving)).toBe(true);
      await advance(page, 1_400);
    } finally {
      try {
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } finally {
        await client.detach();
      }
    }
  }

  await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerMoving)).toBe(false);
  await advance(page, 3_100);
}

async function driveToComplete(page: Page, touch = false): Promise<DontWaveState> {
  for (let guard = 0; guard < 80; guard += 1) {
    const state = await page.evaluate(() => window.__DONT_WAVE__.state());
    if (state.phase === "complete") return state;
    if (state.paused) {
      await activateControl(page, "resume", touch);
      continue;
    }
    switch (state.phase) {
      case "briefing":
        await activateControl(page, "start", touch);
        break;
      case "ready":
        await activateControl(page, "green", touch);
        await advance(page, 700);
        await activateControl(page, "red", touch);
        break;
      case "reveal":
        await advance(page, 400);
        break;
      case "hunt":
        await advance(page, 4_500);
        break;
      case "intermission":
        await activateControl(page, "continue-round", touch);
        break;
      case "descent":
        await advance(page, 3_000);
        break;
      case "crossing-ready":
        await activateControl(page, "begin-crossing", touch);
        break;
      case "crossing-green":
        await useCrossingControl(page, touch);
        break;
      case "crossing-red":
        await advance(page, 650);
        break;
      case "death":
        await advance(page, 1_200);
        break;
    }
  }
  const stopped = await page.evaluate(() => window.__DONT_WAVE__.state().phase);
  throw new Error(`Journey did not complete; stopped at ${stopped}.`);
}

test.describe("desktop watchtower journey", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only journey.");
    await boot(page);
  });

  test("ordinary controls complete the target race and compulsory ending", async ({ page }) => {
    await page.getByTestId("start").click();
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().phase)).toBe("ready");
    await capture(page, "desktop-ready-watchtower.png");

    await page.keyboard.press("KeyG");
    await expect(page.getByTestId("red")).toBeDisabled();
    await advance(page, 700);
    await expect(page.getByTestId("red")).toBeEnabled();
    await page.keyboard.press("KeyR");
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().phase)).toBe("reveal");
    await expect(page.locator("[data-ui='hunt-owner']")).toHaveText("READ THE FIELD");
    await capture(page, "desktop-red-reveal.png");

    await advance(page, 400);
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().phase)).toBe("hunt");
    await expect(page.locator("[data-ui='hunt-owner']")).toHaveText("YOUR WINDOW");
    await capture(page, "desktop-player-head-start.png");

    const missesBefore = await page.evaluate(() => window.__DONT_WAVE__.state().playerMisses);
    const canvas = await page.locator("canvas").boundingBox();
    if (!canvas) throw new Error("Canvas has no bounds.");
    await page.mouse.click(canvas.x + 12, canvas.y + canvas.height - 12);
    await expect(page.locator(".dw-shell")).toHaveClass(/is-miss/);
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().playerMisses)).toBe(missesBefore + 1);
    await aimAndActivateVisibleWaver(page);

    await page.getByRole("button", { name: "Pause game" }).focus();
    await page.keyboard.press("Space");
    const paused = await page.evaluate(() => window.__DONT_WAVE__.state());
    expect(paused.paused).toBe(true);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => window.__DONT_WAVE__.state().phaseElapsedMs)).toBe(paused.phaseElapsedMs);
    await page.getByTestId("resume").focus();
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.__DONT_WAVE__.state().paused)).toBe(false);
    const shotsBeforeResumeSpace = await page.evaluate(() => {
      const state = window.__DONT_WAVE__.state();
      return state.playerHits + state.playerMisses;
    });
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => {
      const state = window.__DONT_WAVE__.state();
      return state.playerHits + state.playerMisses;
    })).toBe(shotsBeforeResumeSpace + 1);
    expect(await page.evaluate(() => window.__DONT_WAVE__.state().paused)).toBe(false);
    await advance(page, 1_100);
    await capture(page, "desktop-side-operators-active.png");

    const complete = await driveToComplete(page);
    expect(complete.phase).toBe("complete");
    expect(complete.history).toHaveLength(8);
    expect(new Set(complete.history.map((turn) => `${turn.address.round}:${turn.address.turn}`)).size).toBe(8);
    expect(complete.playerProgress).toBeGreaterThan(0);
    expect(complete.counts.survivors).toBeGreaterThan(0);
    const sideScore = (complete.operatorHits * 100).toLocaleString("en-GB");
    await expect(page.locator("[data-ui='operator-score']")).toHaveText(sideScore);
    await expect(page.locator(".dw-stat").filter({ hasText: "Side score" })).toContainText(sideScore);
    await expect(page.getByRole("heading", { name: "THE TOWER CONTINUES." })).toBeVisible();
    await capture(page, "desktop-compulsory-ending.png");
    await page.getByTestId("restart").click();
    await expect(page.getByTestId("briefing")).toBeVisible();
  });
});

test.describe("mobile landscape touch journey", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "pixel-7-landscape-chromium", "Landscape touch only.");
    await boot(page);
  });

  test("touch controls remain usable through a complete run", async ({ page }) => {
    const briefingLayout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".dw-panel");
      const start = document.querySelector<HTMLElement>("[data-testid='start']");
      if (!panel || !start) throw new Error("Landscape briefing is missing.");
      const panelBounds = panel.getBoundingClientRect();
      const startBounds = start.getBoundingClientRect();
      return {
        viewportHeight: innerHeight,
        panelTop: panelBounds.top,
        panelBottom: panelBounds.bottom,
        startTop: startBounds.top,
        startBottom: startBounds.bottom,
      };
    });
    expect(briefingLayout.panelTop).toBeGreaterThanOrEqual(-1);
    expect(briefingLayout.panelBottom).toBeLessThanOrEqual(briefingLayout.viewportHeight + 1);
    expect(briefingLayout.startTop).toBeGreaterThanOrEqual(-1);
    expect(briefingLayout.startBottom).toBeLessThanOrEqual(briefingLayout.viewportHeight + 1);

    await page.getByTestId("start").tap();
    await page.getByTestId("green").tap();
    await advance(page, 700);
    await page.getByTestId("red").tap();
    await advance(page, 400);

    await aimAndActivateVisibleWaver(page, "touch");
    await capture(page, "mobile-landscape-hunt.png");

    const layout = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>("button:not([hidden])")].map((button) => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        controls,
      };
    });
    expect(layout.scroll.width).toBeLessThanOrEqual(layout.viewport.width);
    expect(layout.scroll.height).toBeLessThanOrEqual(layout.viewport.height);
    for (const control of layout.controls) {
      expect(control.width).toBeGreaterThanOrEqual(34);
      expect(control.height).toBeGreaterThanOrEqual(34);
      expect(control.left).toBeGreaterThanOrEqual(-1);
      expect(control.right).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(control.top).toBeGreaterThanOrEqual(-1);
      expect(control.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
    }

    const complete = await driveToComplete(page, true);
    expect(complete).toMatchObject({ phase: "complete", playerMoving: false });
    expect(complete.history).toHaveLength(8);
  });
});

test.describe("presentation and provenance smoke", () => {
  test("reduced motion does not stall a hunt or the ending", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Single reduced-motion pass.");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);
    const complete = await driveToComplete(page);
    expect(complete.phase).toBe("complete");
    expect(complete.history).toHaveLength(8);
  });

  test("the UI makes no quantum claim and the complete run makes no external request", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "pixel-7-portrait-chromium", "Portrait smoke only.");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await boot(page);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/QPU|quantum|particle|collapse|entangl|circuit/i);
    expect(bodyText).not.toMatch(/prepared outcomes?|observation field/i);
    await page.getByTestId("start").tap();
    const orientationBounds = await page.locator(".dw-orientation-note").boundingBox();
    const greenBounds = await page.getByTestId("green").boundingBox();
    if (!orientationBounds || !greenBounds) throw new Error("Portrait controls are missing layout bounds.");
    expect(greenBounds.height).toBeGreaterThanOrEqual(44);
    expect(greenBounds.y + greenBounds.height).toBeLessThanOrEqual(orientationBounds.y);
    await page.getByTestId("green").tap();
    await advance(page, 700);
    await page.getByTestId("red").tap();
    const internal = await page.evaluate(() => window.__DONT_WAVE__.state().currentRecord);
    expect(internal).toMatchObject({
      schemaVersion: 2,
      address: { round: 1, turn: 1 },
      provenance: {
        kind: "classical-demo",
        modelId: "dw-prepared-turn-v2",
        preparedBeforePlay: true,
      },
    });
    const complete = await driveToComplete(page, true);
    expect(complete.phase).toBe("complete");
    expect(complete.history).toHaveLength(8);
    const origin = new URL(page.url()).origin;
    expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
    await expect(page.locator(".dw-orientation-note")).toBeVisible();
  });
});
