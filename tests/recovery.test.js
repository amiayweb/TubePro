import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isYouTubeSender,
  mergeObservedFormats,
  verifyMediaFormats,
} from "../src/recovery.js";
import { extractFromPage } from "../src/extractor.js";

test("SPA messages accept the original document URL while retaining sender security", () => {
  assert.equal(
    isYouTubeSender({
      tab: { id: 4 },
      frameId: 0,
      url: "https://www.youtube.com/",
    }),
    true,
  );
  assert.equal(
    isYouTubeSender({
      tab: { id: 4 },
      frameId: 0,
      url: "https://www.youtube.com/watch?v=OLDVIDEO123",
    }),
    true,
  );
  assert.equal(
    isYouTubeSender({
      tab: { id: 4 },
      frameId: 1,
      url: "https://www.youtube.com/",
    }),
    false,
  );
  assert.equal(
    isYouTubeSender({
      tab: { id: 4 },
      frameId: 0,
      url: "https://www.youtube.com.evil.test/",
    }),
    false,
  );
});

test("reuse transformed n and proof token only for the matching media identity and itag", () => {
  const base =
    "https://r1.googlevideo.com/videoplayback?id=CONTENT&itag=137&source=youtube&n=raw";
  const resolved = base.replace(
    "n=raw",
    "n=transformed&pot=proof&range=0-200&ump=1",
  );
  const [result] = mergeObservedFormats(
    [
      {
        itag: 137,
        signatureCipher: new URLSearchParams({
          url: base,
          s: "signature",
        }).toString(),
        ciphered: true,
      },
    ],
    [resolved, resolved.replace("id=CONTENT", "id=ADVERTISEMENT")],
  );
  assert.equal(new URL(result.url).searchParams.get("n"), "transformed");
  assert.equal(new URL(result.url).searchParams.get("pot"), "proof");
  assert.equal(new URL(result.url).searchParams.has("range"), false);
  assert.equal(new URL(result.url).searchParams.has("ump"), false);
  assert.equal(result.ciphered, false);
  assert.equal(
    mergeObservedFormats(
      [{ itag: 137, url: base }],
      [resolved.replace("id=CONTENT", "id=ADVERTISEMENT")],
    )[0].url,
    base,
  );
});

test("HTTP rejection is diagnosed before decoding; only actual media is retained", async () => {
  const formats = [137, 140, 18].map((itag) => ({
    itag,
    bitrate: itag,
    url: `https://r1.googlevideo.com/videoplayback?itag=${itag}`,
  }));
  const fetcher = async (url) => {
    const itag = new URL(url).searchParams.get("itag");
    return itag === "137"
      ? new Response("Denied", { status: 403 })
      : itag === "18"
        ? new Response("<html>Error</html>", {
            headers: { "content-type": "text/html" },
          })
        : new Response("media", {
            status: 206,
            headers: { "content-type": "audio/mp4" },
          });
  };
  assert.deepEqual(
    (await verifyMediaFormats(formats, fetcher)).map((item) => item.itag),
    [140],
  );
  await assert.rejects(verifyMediaFormats([formats[0]], fetcher), /HTTP 403/);
});

test("extractor checks the live watch URL, not the stale MessageSender URL", async () => {
  const previous = {
    location: globalThis.location,
    document: globalThis.document,
    window: globalThis.window,
  };
  const id = "dQw4w9WgXcQ";
  globalThis.location = {
    origin: "https://www.youtube.com",
    pathname: "/watch",
    href: `https://www.youtube.com/watch?v=${id}`,
  };
  globalThis.document = {
    getElementById: () => ({
      getPlayerResponse: () => ({
        videoDetails: { videoId: id, lengthSeconds: "30" },
        playabilityStatus: { status: "OK" },
        streamingData: {
          formats: [{ url: "https://r1.googlevideo.com/file", itag: 18 }],
        },
      }),
    }),
  };
  globalThis.window = {};
  try {
    assert.equal((await extractFromPage(id)).videoId, id);
    await assert.rejects(extractFromPage("abcdefghijk"), /no longer open/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
