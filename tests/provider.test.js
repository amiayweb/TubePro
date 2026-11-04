import { test } from "node:test";
import assert from "node:assert/strict";
import { requestIndependentInfo, requestSessionInfo } from "../src/provider.js";

test("independent extraction uses the working client profile without account credentials", async () => {
  const id = "dQw4w9WgXcQ";
  let request;
  const result = await requestIndependentInfo(id, async (url, options) => {
    request = { url, options };
    return Response.json({
      videoDetails: { videoId: id },
      playabilityStatus: { status: "OK" },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 137,
            url: "https://r1.googlevideo.com/videoplayback",
            mimeType: 'video/mp4; codecs="avc1.640028"',
            initRange: { start: "0", end: "700" },
            indexRange: { start: "701", end: "1000" },
          },
        ],
      },
    });
  });
  assert.equal(request.options.credentials, "omit");
  assert.equal(
    JSON.parse(request.options.body).context.client.clientName,
    "VISIONOS",
  );
  assert.equal(request.options.headers["X-YouTube-Client-Name"], "101");
  assert.equal(result.sourceClient, "VISIONOS");
  assert.equal(result.formats[0].itag, 137);
  assert.deepEqual(result.formats[0].indexRange, { start: "701", end: "1000" });
});

test("independent extraction rejects wrong-video, refused and cipher-only responses", async () => {
  const id = "dQw4w9WgXcQ";
  await assert.rejects(
    requestIndependentInfo(
      id,
      async () => new Response("Denied", { status: 403 }),
    ),
    /HTTP 403/,
  );
  await assert.rejects(
    requestIndependentInfo(id, async () =>
      Response.json({
        videoDetails: { videoId: "abcdefghijk" },
        playabilityStatus: { status: "OK" },
      }),
    ),
    /different video/,
  );
  await assert.rejects(
    requestIndependentInfo(id, async () =>
      Response.json({
        videoDetails: { videoId: id },
        playabilityStatus: { status: "OK" },
        streamingData: { formats: [{ signatureCipher: "s=encrypted" }] },
      }),
    ),
    /no direct media/,
  );
});

test("YouTube playability refusal retains its exact status and reason", async () => {
  await assert.rejects(
    requestIndependentInfo("dQw4w9WgXcQ", async () =>
      Response.json({
        playabilityStatus: {
          status: "LOGIN_REQUIRED",
          reason: "Sign in to confirm your age",
        },
      }),
    ),
    /LOGIN_REQUIRED: Sign in to confirm your age/,
  );
});

test("session retry keeps credentials in the page and returns only stream metadata", async () => {
  const previous = {
    location: globalThis.location,
    window: globalThis.window,
    fetch: globalThis.fetch,
  };
  const id = "zrpaakpqSK0";
  let options;
  globalThis.location = {
    origin: "https://www.youtube.com",
    pathname: "/watch",
    href: `https://www.youtube.com/watch?v=${id}`,
  };
  globalThis.window = {
    ytcfg: {
      get: (key) =>
        key === "INNERTUBE_CONTEXT"
          ? { client: { visitorData: "session-visitor", hl: "en", gl: "US" } }
          : undefined,
    },
  };
  globalThis.fetch = async (_url, input) => {
    options = input;
    return Response.json({
      videoDetails: { videoId: id },
      playabilityStatus: { status: "OK" },
      accountData: "must-not-leave-page",
      streamingData: {
        formats: [{ itag: 18, url: "https://r.googlevideo.com/file" }],
      },
    });
  };
  try {
    const result = await requestSessionInfo(id);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["X-Goog-Visitor-Id"], "session-visitor");
    assert.deepEqual(Object.keys(result), ["streamingData"]);
    assert.equal(JSON.stringify(result).includes("session-visitor"), false);
    globalThis.fetch = async () =>
      Response.json({
        playabilityStatus: {
          status: "LOGIN_REQUIRED",
          reason: "Sign in to confirm you’re not a bot",
        },
      });
    await assert.rejects(
      requestSessionInfo(id),
      /LOGIN_REQUIRED: Sign in to confirm/,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
