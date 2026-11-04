import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createResumeWriter } from "../src/history.js";
const data = {};
const storage = {
  async get(key) {
    return { [key]: data[key] };
  },
  async set(record) {
    Object.assign(data, record);
  },
};
const save = createResumeWriter(storage);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TUBEPRO_BROWSER
    ? { executablePath: process.env.TUBEPRO_BROWSER }
    : {}),
  timeout: 15000,
});
try {
  const context = await browser.newContext();
  await context.exposeFunction("__readStorage", (key) => storage.get(key));
  await context.exposeFunction("__runtimeMessage", async (message) => {
    if (message.type !== "SAVE_RESUME") return { ok: true, data: [] };
    await save(message.videoId, message.position, message.duration, message);
    return { ok: true, data: true };
  });
  await context.addInitScript(() => {
    globalThis.chrome = {
      runtime: {
        sendMessage: async (message) => {
          const result = await globalThis.__runtimeMessage(message);
          if (message.type === "SAVE_RESUME")
            globalThis.__savedPosition = message.position;
          return result;
        },
      },
      storage: { local: { get: (key) => globalThis.__readStorage(key) } },
    };
  });
  const bytes = await readFile("tests/fixtures/sample.mp4");
  await context.route("https://r1.googlevideo.com/**", (route) => {
    const range = route.request().headers().range ?? "bytes=0-";
    const [, startValue, endValue] = /bytes=(\d+)-(\d*)/.exec(range);
    const start = Number(startValue);
    const end = endValue
      ? Math.min(Number(endValue), bytes.length - 1)
      : bytes.length - 1;
    return route.fulfill({
      status: 206,
      body: bytes.subarray(start, end + 1),
      headers: {
        "content-type": "video/mp4",
        "content-range": `bytes ${start}-${end}/${bytes.length}`,
        "access-control-allow-origin": "*",
      },
    });
  });
  async function open() {
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(error.message));
    await page.goto(pathToFileURL(resolve("dists/chrome/player.html")).href);
    await page.evaluate(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data.type === "READY") globalThis.__ready = true;
        if (event.data.type === "FALLBACK")
          globalThis.__failure = event.data.reason;
      };
      const info = {
        videoId: "zrpaakpqSK0",
        title: "Resume regression fixture",
        duration: 30,
        status: "OK",
        position: 0,
        paused: true,
        formats: [
          {
            itag: 18,
            url: "https://r1.googlevideo.com/videoplayback",
            mimeType: 'video/mp4; codecs="avc1.42C01E, mp4a.40.2"',
            bitrate: 500000,
            width: 640,
            height: 360,
            qualityLabel: "360p",
            audioQuality: "AUDIO_QUALITY_MEDIUM",
          },
        ],
      };
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.youtube.com",
          source: window,
          ports: [channel.port2],
          data: {
            type: "TUBEPRO_INIT",
            info,
            settings: { sponsorBlock: false },
          },
        }),
      );
    });
    await page.waitForFunction(
      () => globalThis.__ready || globalThis.__failure,
    );
    const failure = await page.evaluate(() => globalThis.__failure);
    if (failure) throw new Error(failure);
    return page;
  }
  let page = await open();
  await page.evaluate(() => {
    const seek = document.getElementById("seek");
    seek.value = "40";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => globalThis.__savedPosition >= 11.9);
  await page.close();
  // Reproduce a delayed write from the departing parent page.
  await save("zrpaakpqSK0", 0, 30, { sampledAt: Date.now() - 1000 });
  page = await open();
  const position = await page
    .locator("video")
    .evaluate((video) => video.currentTime);
  if (Math.abs(position - 12) > 0.5)
    throw new Error(`Expected resume at 12 seconds, got ${position}`);
  console.log(
    `Seek → close → reopen: PASS (resumed at ${position.toFixed(2)} seconds)`,
  );
} finally {
  await browser.close();
}
