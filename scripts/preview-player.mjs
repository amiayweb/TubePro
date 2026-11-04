import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TUBEPRO_BROWSER
    ? { executablePath: process.env.TUBEPRO_BROWSER }
    : {}),
  timeout: 15000,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.goto(pathToFileURL(resolve("dists/chrome/player.html")).href);
  await page.evaluate(() => {
    document.getElementById("loading").hidden = true;
    document.getElementById("title").textContent =
      "An evening above the clouds";
    document.getElementById("stream-badge").textContent = "1080p60";
    document.getElementById("time").textContent = "13:53 / 17:30";
    document.getElementById("seek").style.setProperty("--progress", "79%");
    document.getElementById("seek").value = "79";
    const video = document.querySelector("video");
    Object.defineProperty(video, "paused", { get: () => false });
    video.dispatchEvent(new Event("play"));
  });
  await mkdir(".preview", { recursive: true });
  await page.screenshot({ path: ".preview/player-desktop.png" });
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".bottom")).opacity === "0",
  );
  console.log("Fullscreen controls hide after pointer activation: PASS");
  await page.evaluate(() => document.exitFullscreen());
  await page.setViewportSize({ width: 480, height: 300 });
  await page.mouse.move(200, 200);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".bottom")).opacity === "1",
  );
  await page.screenshot({ path: ".preview/player-compact.png" });
  const overflow = await page.evaluate(() => {
    const controls = document.querySelector(".controls");
    return controls.scrollWidth > controls.clientWidth;
  });
  if (overflow) throw new Error("Compact player controls overflow.");
  console.log("Compact control layout: PASS");
} finally {
  await browser.close();
}
