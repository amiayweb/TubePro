import { createFile } from "mp4box";
import { mediaURL } from "./shared.js";

/** Feed fetched MP4 bytes to MSE instead of giving the remote URL to <video>.
 * MP4Box converts the muxed file into audio/video fragments without re-encoding.
 */
export class ProgressivePlayer {
  constructor(video, onError) {
    this.video = video;
    this.onError = onError;
    this.destroyed = false;
    this.buffers = [];
    this.abort = new AbortController();
    this.request = 0;
  }

  async load(format, position = 0) {
    if (!mediaURL(format.url) || !format.mimeType.startsWith("video/mp4"))
      throw new Error(
        "Buffered direct playback requires a compatible MP4 stream.",
      );
    this.format = format;
    this.file = createFile(true);
    this.media = new MediaSource();
    this.objectURL = URL.createObjectURL(this.media);
    const opened = new Promise((resolve) =>
      this.media.addEventListener("sourceopen", resolve, { once: true }),
    );
    const loaded = new Promise((resolve, reject) => {
      this.rejectLoad = reject;
      this.onLoaded = resolve;
      this.video.addEventListener("loadeddata", this.onLoaded, { once: true });
    });
    this.loadTimer = setTimeout(
      () =>
        this.error(
          new Error(
            "Buffered MP4 playback did not become ready within 12 seconds.",
          ),
        ),
      12000,
    );
    this.onVideoError = () =>
      this.error(
        new Error(
          `Buffered MP4 decoder error ${this.video.error?.code ?? "unknown"}: ${this.video.error?.message || "unsupported media"}`,
        ),
      );
    this.video.addEventListener("error", this.onVideoError);
    this.video.src = this.objectURL;
    this.video.load();
    await opened;
    if (this.destroyed) return;
    this.file.onError = (error) =>
      this.error(new Error(`MP4 parsing failed: ${String(error)}`));
    this.file.onReady = (info) => {
      try {
        const tracks = info.tracks.filter(
          (track) => track.video || track.audio,
        );
        if (!tracks.length)
          throw new Error("The media response contains no audio/video tracks.");
        this.media.duration = info.duration / info.timescale;
        for (const track of tracks) {
          const mime = `${track.video ? "video" : "audio"}/mp4; codecs="${track.codec}"`;
          if (!MediaSource.isTypeSupported(mime))
            throw new Error(`The browser cannot decode ${track.codec}.`);
          const buffer = this.media.addSourceBuffer(mime);
          const state = { buffer, queue: [], track: track.id };
          this.buffers.push(state);
          buffer.addEventListener("updateend", () => this.pump(state));
          buffer.addEventListener("error", () =>
            this.error(
              new Error(`The browser rejected ${track.codec} media fragments.`),
            ),
          );
          this.file.setSegmentOptions(track.id, state, {
            nbSamples: 48,
            rapAlignement: true,
          });
        }
        for (const init of this.file.initializeSegmentation("per-track")) {
          init.user.queue.push({ buffer: init.buffer });
          this.pump(init.user);
        }
        this.file.onSegment = (id, state, buffer, sample) => {
          state.queue.push({ buffer, sample, id });
          this.pump(state);
        };
        this.file.start();
        this.onSeek = () => {
          const time = this.video.currentTime;
          const ranges = this.video.buffered;
          for (let index = 0; index < ranges.length; index++)
            if (time >= ranges.start(index) && time < ranges.end(index) - 0.2)
              return;
          const point = this.file.seek(time, true);
          void this.read(point.offset);
        };
        this.video.addEventListener("seeking", this.onSeek);
        if (position > 0)
          this.video.currentTime = Math.min(
            position,
            Math.max(0, this.media.duration - 0.1),
          );
      } catch (error) {
        this.error(error);
      }
    };
    void this.read(0);
    await loaded;
    clearTimeout(this.loadTimer);
    this.rejectLoad = null;
  }

  pump(state) {
    if (
      this.destroyed ||
      state.buffer.updating ||
      this.media.readyState !== "open"
    )
      return;
    try {
      // Keep a small back buffer; fetching pauses when 45 seconds are queued ahead.
      if (
        state.buffer.buffered.length &&
        this.video.currentTime > 40 &&
        state.buffer.buffered.start(0) < this.video.currentTime - 35
      ) {
        state.buffer.remove(0, this.video.currentTime - 30);
        return;
      }
      const next = state.queue.shift();
      if (next) {
        state.buffer.appendBuffer(next.buffer);
        if (next.sample != null)
          this.file.releaseUsedSamples(next.id, next.sample);
      }
    } catch (error) {
      this.error(error);
    }
  }

  async read(offset) {
    const request = ++this.request;
    this.fetchAbort?.abort();
    this.fetchAbort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, this.fetchAbort.signal]);
    try {
      const url = new URL(this.format.url);
      // Googlevideo accepts query byte ranges; preserve any signed range.
      if (!(url.searchParams.get("sparams") ?? "").split(",").includes("range"))
        url.searchParams.set("range", `${offset}-`);
      const response = await fetch(url, {
        credentials: "omit",
        headers: { Range: `bytes=${offset}-` },
        signal,
      });
      if (!response.ok)
        throw new Error(`Media transfer rejected (HTTP ${response.status}).`);
      if (
        !/^(video\/|audio\/|application\/octet-stream)/i.test(
          response.headers.get("content-type") ?? "",
        )
      )
        throw new Error("YouTube returned a non-media response.");
      const reader = response.body.getReader();
      while (!signal.aborted && !this.destroyed && request === this.request) {
        const { done, value } = await reader.read();
        if (done) {
          this.file.flush();
          break;
        }
        const bytes = value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        );
        bytes.fileStart = offset;
        this.file.appendBuffer(bytes);
        offset += bytes.byteLength;
        while (
          !signal.aborted &&
          this.video.buffered.length &&
          this.video.buffered.end(this.video.buffered.length - 1) -
            this.video.currentTime >
            45
        )
          await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await reader.cancel().catch(() => {});
    } catch (error) {
      if (!signal.aborted && !this.destroyed) this.error(error);
    }
  }

  error(error) {
    if (this.destroyed) return;
    this.rejectLoad?.(error);
    this.onError(error);
  }

  destroy() {
    this.destroyed = true;
    this.abort.abort();
    clearTimeout(this.loadTimer);
    this.file?.stop();
    this.video.removeEventListener("seeking", this.onSeek);
    this.video.removeEventListener("loadeddata", this.onLoaded);
    this.video.removeEventListener("error", this.onVideoError);
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
    for (const state of this.buffers) state.queue.length = 0;
  }
}
