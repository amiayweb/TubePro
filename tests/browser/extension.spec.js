import { test as base, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const videoId = "dQw4w9WgXcQ";
const media = "https://r1---sn-test.googlevideo.com/videoplayback";
const test = base.extend({
  // Playwright requires fixture arguments to use destructuring.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), "tubepro-test-"));
    const extension = resolve("dists/chrome");
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await use(new URL(worker.url()).host);
  },
});

class WatchPage {
  constructor(page) {
    this.page = page;
    this.player = page.frameLocator('iframe[title="TubePro video player"]');
    this.native = page.locator("#movie_player");
  }
  async open(mode = "cipher") {
    await this.page.route("https://www.youtube.com/**", async (route) => {
      const id =
        new URL(route.request().url()).searchParams.get("v") ?? videoId;
      const formats =
        mode === "direct" || mode === "rejected"
          ? [
              {
                itag: 18,
                url: media,
                mimeType: 'video/mp4; codecs="avc1.42C01E, mp4a.40.2"',
                bitrate: 500000,
                width: 640,
                height: 360,
                qualityLabel: "360p",
                audioQuality: "AUDIO_QUALITY_MEDIUM",
              },
            ]
          : [
              {
                itag: 137,
                signatureCipher: "s=ciphered",
                mimeType: 'video/mp4; codecs="avc1.640028"',
              },
            ];
      const response = {
        videoDetails: {
          videoId: id,
          title: "The quiet side of the internet",
          lengthSeconds: "30",
        },
        playabilityStatus: { status: "OK" },
        streamingData: { formats },
      };
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><title>YouTube fixture</title><style>body{background:#101114;color:#fff;margin:0;font:16px system-ui}#container{position:relative;width:100%;max-width:1100px;aspect-ratio:16/9;margin:40px auto}#movie_player{width:100%;height:100%;background:#20232c}video{width:100%;height:100%}</style></head><body><div id="container"><div id="movie_player"><video></video><strong>Original YouTube player</strong></div></div><script>window.ytInitialPlayerResponse=${JSON.stringify(response)};document.getElementById('movie_player').getPlayerResponse=()=>window.ytInitialPlayerResponse;</script></body></html>`,
      });
    });
    if (mode === "direct") {
      const bytes = await readFile(resolve("tests/fixtures/sample.mp4"));
      await this.page.context().route(`${media}**`, (route) =>
        route.fulfill({
          body: bytes,
          contentType: "video/mp4",
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Accept-Ranges": "bytes",
          },
        }),
      );
    }
    if (mode === "rejected")
      await this.page
        .context()
        .route(`${media}**`, (route) =>
          route.fulfill({ status: 403, body: "Expired stream" }),
        );
    await this.page.goto(`https://www.youtube.com/watch?v=${videoId}`);
  }
  async restored() {
    await expect(this.page.locator("#tubepro-notice")).toBeAttached();
    await expect(
      this.page.locator('iframe[title="TubePro video player"]'),
    ).toHaveCount(0);
    await expect(this.native).toHaveCSS("visibility", "visible");
    await expect(this.page.locator("#container")).toHaveCSS(
      "position",
      "relative",
    );
  }
}

test("ciphered-only video restores the untouched original player", async ({
  page,
  extensionId,
}) => {
  expect(extensionId).toBeTruthy();
  const watch = new WatchPage(page);
  await watch.open();
  await watch.restored();
  await expect(page.locator("#movie_player strong")).toHaveText(
    "Original YouTube player",
  );
});

test("a rejected media URL restores YouTube instead of a black player", async ({
  page,
  extensionId,
}) => {
  expect(extensionId).toBeTruthy();
  const watch = new WatchPage(page);
  await watch.open("rejected");
  await watch.restored();
});

test("direct playback, quality controls, responsive UI and manual fallback", async ({
  page,
  extensionId,
}, testInfo) => {
  const settings = await page.context().newPage();
  await settings.goto(`chrome-extension://${extensionId}/popup.html`);
  await settings
    .getByRole("switch", { name: "SponsorBlock", exact: false })
    .uncheck();
  await settings.close();
  const watch = new WatchPage(page);
  await watch.open("direct");
  await expect(
    watch.player.getByRole("heading", {
      name: "The quiet side of the internet",
    }),
  ).toBeVisible();
  await expect(watch.player.getByLabel("Video quality")).toHaveValue("0");
  await expect(
    watch.player.getByRole("heading", {
      name: "A better seat for your video.",
    }),
  ).toBeHidden();
  await expect(watch.native).toHaveCSS("visibility", "hidden");
  await watch.player.getByLabel("Playback speed").selectOption("1.5");
  await expect
    .poll(() =>
      page
        .frames()
        .find((frame) => frame.url().endsWith("/player.html"))
        ?.evaluate(() => document.querySelector("video").playbackRate),
    )
    .toBe(1.5);
  await page.screenshot({ path: testInfo.outputPath("player-desktop.png") });
  await page.setViewportSize({ width: 480, height: 400 });
  await page.screenshot({ path: testInfo.outputPath("player-compact.png") });
  await watch.player.getByRole("button", { name: "YouTube player" }).click();
  await watch.restored();
});

test("popup saves preferences and disabling restores active playback", async ({
  page,
  extensionId,
}) => {
  const watch = new WatchPage(page);
  await watch.open("direct");
  await expect(watch.player.getByLabel("Video quality")).toHaveValue("0");
  const popup = await page.context().newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("switch", { name: "Enable TubePro" }).uncheck();
  await expect(
    page.locator('iframe[title="TubePro video player"]'),
  ).toHaveCount(0);
  await expect(watch.native).toHaveCSS("visibility", "visible");
  await popup.reload();
  await expect(
    popup.getByRole("switch", { name: "Enable TubePro" }),
  ).not.toBeChecked();
  await expect(
    popup.getByText("Original YouTube playback", { exact: true }),
  ).toBeVisible();
});

test("SPA navigation removes the extension player and guards", async ({
  page,
  extensionId,
}) => {
  expect(extensionId).toBeTruthy();
  const watch = new WatchPage(page);
  await watch.open("direct");
  await expect(watch.player.getByLabel("Video quality")).toHaveValue("0");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("yt-navigate-start"));
    history.pushState({}, "", "/");
    document.dispatchEvent(new Event("yt-navigate-finish"));
  });
  await expect(
    page.locator('iframe[title="TubePro video player"]'),
  ).toHaveCount(0);
  await expect(watch.native).toHaveCSS("visibility", "visible");
  await expect(page.locator("#tubepro-notice")).toHaveCount(0);
});
