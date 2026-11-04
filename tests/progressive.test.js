import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createFile } from "mp4box";
import { ProgressivePlayer } from "../src/progressive.js";

test("real muxed MP4 becomes separate initialized audio/video MSE fragments", async () => {
  const bytes = await readFile(
    new URL("./fixtures/sample.mp4", import.meta.url),
  );
  const file = createFile(true);
  const initSegments = [];
  const segments = [];
  let tracks;
  file.onError = (error) => assert.fail(String(error));
  file.onReady = (info) => {
    tracks = info.tracks;
    for (const track of tracks)
      file.setSegmentOptions(track.id, track.id, { nbSamples: 48 });
    initSegments.push(...file.initializeSegmentation("per-track"));
    file.onSegment = (id, _user, buffer) => segments.push({ id, buffer });
    file.start();
  };
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + 16384, bytes.length),
    );
    const buffer = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    );
    buffer.fileStart = offset;
    file.appendBuffer(buffer);
  }
  file.flush();
  assert.equal(tracks.length, 2);
  assert.equal(initSegments.length, 2);
  for (const init of initSegments)
    assert.match(Buffer.from(init.buffer).toString("latin1"), /moov/);
  for (const track of tracks) {
    const fragments = segments.filter((segment) => segment.id === track.id);
    assert.ok(fragments.length > 0);
    assert.match(Buffer.from(fragments[0].buffer).toString("latin1"), /moof/);
  }
});

test("buffered transport never assigns a remote URL to the video element", async () => {
  const previous = {
    MediaSource: globalThis.MediaSource,
    fetch: globalThis.fetch,
  };
  const fixture = await readFile(
    new URL("./fixtures/sample.mp4", import.meta.url),
  );
  const appends = [];
  const requests = [];
  class MockVideo extends EventTarget {
    currentTime = 0;
    buffered = { length: 0 };
    load() {}
  }
  const video = new MockVideo();
  class MockMediaSource extends EventTarget {
    constructor() {
      super();
      this.readyState = "open";
      queueMicrotask(() => this.dispatchEvent(new Event("sourceopen")));
    }
    static isTypeSupported() {
      return true;
    }
    addSourceBuffer() {
      const buffer = new EventTarget();
      buffer.buffered = { length: 0 };
      buffer.appendBuffer = (data) => {
        appends.push(data);
        queueMicrotask(() => {
          buffer.dispatchEvent(new Event("updateend"));
          if (appends.length >= 4) video.dispatchEvent(new Event("loadeddata"));
        });
      };
      return buffer;
    }
  }
  globalThis.MediaSource = MockMediaSource;
  const createURL = URL.createObjectURL;
  const revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:local-buffered-media";
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(fixture, {
      status: 206,
      headers: { "content-type": "video/mp4" },
    });
  };
  const errors = [];
  const player = new ProgressivePlayer(video, (error) => errors.push(error));
  try {
    await player.load({
      url: "https://r1.googlevideo.com/videoplayback?itag=18",
      mimeType: 'video/mp4; codecs="avc1.42C01E, mp4a.40.2"',
    });
    assert.equal(video.src, "blob:local-buffered-media");
    assert.equal(requests[0].options.credentials, "omit");
    assert.equal(requests[0].options.headers.Range, "bytes=0-");
    assert.ok(appends.length >= 4);
    assert.equal(errors.length, 0);
  } finally {
    player.destroy();
    URL.createObjectURL = createURL;
    URL.revokeObjectURL = revokeURL;
    globalThis.MediaSource = previous.MediaSource;
    globalThis.fetch = previous.fetch;
  }
});
