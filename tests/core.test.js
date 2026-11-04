import { test } from "node:test";
import assert from "node:assert/strict";
import {
  watchId,
  mediaURL,
  cleanSettings,
  cleanSegments,
  timeLabel,
} from "../src/shared.js";
import { selectStreams, dashManifest } from "../src/streams.js";
import { manifest } from "../src/manifest.js";

const format = (type, extra = {}) => ({
  itag: type === "video" ? 137 : 140,
  url: "https://r1---sn-test.googlevideo.com/videoplayback?a=1&b=2",
  mimeType: `${type}/mp4; codecs="${type === "video" ? "avc1.640028" : "mp4a.40.2"}"`,
  bitrate: 1000000,
  initRange: { start: "0", end: "700" },
  indexRange: { start: "701", end: "1000" },
  width: 1920,
  height: 1080,
  ...extra,
});
const info = (formats) => ({
  status: "OK",
  duration: 120,
  live: false,
  formats,
});
test("watch IDs exclude lookalike origins, invalid IDs and non-watch routes", () => {
  assert.equal(
    watchId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  for (const url of [
    "https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=bad",
    "garbage",
  ])
    assert.equal(watchId(url), null);
});
test("media endpoints are restricted to secure googlevideo subdomains", () => {
  assert.ok(mediaURL(format("video").url));
  for (const url of [
    "https://evil.test/file.mp4",
    "https://googlevideo.com.evil.test/file",
    "http://r.googlevideo.com/file",
    "https://user:pass@r.googlevideo.com/file",
    "https://r.googlevideo.com:8080/file",
    "javascript:alert(1)",
  ])
    assert.equal(mediaURL(url), null);
});
test("adaptive streams retain separate video and default audio, and XML escapes URLs", () => {
  const streams = selectStreams(
    info([
      format("video"),
      format("audio"),
      format("audio", {
        itag: 141,
        audioTrack: { audioIsDefault: false },
        bitrate: 2000000,
      }),
    ]),
  );
  assert.equal(streams.kind, "dash");
  assert.equal(streams.audios[0].itag, 140);
  const mpd = dashManifest(streams);
  assert.match(mpd, /a=1&amp;b=2/);
  assert.match(mpd, /indexRange="701-1000"/);
  assert.match(mpd, /contentType="audio"/);
  assert.match(mpd, /mediaPresentationDuration="PT120S"/);
});
test("ciphered, unsupported, incomplete, malformed and live streams trigger fallback", () => {
  assert.throws(() =>
    selectStreams(
      info([{ ...format("video"), url: undefined, ciphered: true }]),
    ),
  );
  assert.throws(() =>
    selectStreams(info([format("video"), format("audio")]), () => false),
  );
  assert.throws(() => selectStreams(info([format("video")])));
  assert.throws(() => selectStreams({ ...info([]), live: true }));
  assert.throws(() => selectStreams({ ...info([]), status: "LOGIN_REQUIRED" }));
  assert.throws(() =>
    selectStreams(
      info([
        format("video", { indexRange: { start: "x", end: "4" } }),
        format("audio"),
      ]),
    ),
  );
});
test("muxed progressive fallback includes audio and picks highest quality first", () => {
  const streams = selectStreams(
    info([
      format("video", {
        initRange: undefined,
        indexRange: undefined,
        audioQuality: "AUDIO_QUALITY_MEDIUM",
        height: 360,
      }),
      format("video", {
        initRange: undefined,
        indexRange: undefined,
        audioQuality: "AUDIO_QUALITY_MEDIUM",
        height: 720,
      }),
    ]),
  );
  assert.equal(streams.kind, "progressive");
  assert.equal(streams.formats[0].height, 720);
});
test("SponsorBlock ignores invalid segments, non-skip actions, and out-of-video bounds", () => {
  assert.deepEqual(
    cleanSegments(
      [
        { category: "sponsor", segment: [5, 10] },
        { category: "sponsor", segment: [-1, 2] },
        { category: "unknown", segment: [5, 10] },
        { category: "sponsor", segment: [5, 400] },
        { category: "sponsor", segment: [4, 8], actionType: "mute" },
      ],
      120,
    ),
    [{ category: "sponsor", start: 5, end: 10 }],
  );
});
test("settings are bounded and display times handle malformed values", () => {
  assert.equal(cleanSettings({ volume: 90 }).volume, 1);
  assert.equal(
    cleanSettings({ preferredQuality: "evil" }).preferredQuality,
    "auto",
  );
  assert.equal(timeLabel(3661), "1:01:01");
  assert.equal(timeLabel(Infinity), "0:00");
});
test("build manifests select the correct background implementation without broad permissions", () => {
  assert.deepEqual(manifest("chrome", "0.1.0").background, {
    service_worker: "background.js",
  });
  assert.deepEqual(manifest("firefox", "0.1.0").background, {
    scripts: ["background.js"],
  });
  assert.ok(
    !manifest("chrome", "0.1.0").host_permissions.includes("<all_urls>"),
  );
});
