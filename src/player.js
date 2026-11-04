import shaka from "shaka-player/dist/shaka-player.compiled.js";
import { selectStreams, dashManifest } from "./streams.js";
import { cleanSettings, cleanSegments, timeLabel, watchId } from "./shared.js";
import { verifyMediaFormats } from "./recovery.js";
import { ProgressivePlayer } from "./progressive.js";
import { setIcon } from "./icons.js";
import { controlsVisibility } from "./visibility.js";
import { readResume } from "./history.js";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const video = $("video");
const shell = $("player");
let port;
let engine;
let source;
let settings;
let segments = [];
let sponsorEnabled = true;
let ready = false;
let failed = false;
let info;
let lastProgress = Date.now();
let lastPosition = -1;
let toastTimer;
let ignoredUntil = -1;
let undoPosition = 0;
let manifestURL;
let initialized = false;
let progressive;
let recovering = false;
let recovered = false;
let verifiedFormats = [];
let lastSavedAt = 0;
for (const element of document.querySelectorAll("[data-icon]"))
  setIcon(element, element.dataset.icon);
const visibility = controlsVisibility(shell, video);
function savePosition({ ended = false, reset = false } = {}) {
  if (!ready || failed || recovering || !info?.videoId || !api?.runtime) return;
  lastSavedAt = Date.now();
  reportState(lastSavedAt);
  void api.runtime
    .sendMessage({
      type: "SAVE_RESUME",
      videoId: info.videoId,
      position: video.currentTime,
      duration: video.duration,
      sampledAt: lastSavedAt,
      ended,
      reset,
    })
    .catch(() => {});
}

function send(message) {
  port?.postMessage(message);
}
function reportState(sampledAt = Date.now()) {
  if (ready)
    send({
      type: "STATE",
      position: video.currentTime,
      paused: video.paused,
      duration: video.duration,
      sampledAt,
    });
}
function fail(reason, manual = false) {
  if (failed) return;
  savePosition();
  failed = true;
  reportState();
  video.pause();
  progressive?.destroy();
  send({ type: "FALLBACK", reason: String(reason).slice(0, 300), manual });
  if (engine) void engine.destroy().catch(() => {});
}
function toast(text, undo = false) {
  clearTimeout(toastTimer);
  $("toast-text").textContent = text;
  $("undo").hidden = !undo;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 5000);
}
function wake() {
  visibility.wake();
}
async function play() {
  try {
    await video.play();
  } catch (error) {
    if (error.name === "NotAllowedError") {
      $("center-play").hidden = false;
      toast("Press play to start your video.");
    } else if (error.name !== "AbortError")
      fail("The browser could not start this stream.");
  }
}
function togglePlay() {
  if (video.paused) void play();
  else video.pause();
}
function seek(delta) {
  if (!Number.isFinite(video.duration)) return;
  video.currentTime = Math.max(
    0,
    Math.min(video.duration, video.currentTime + delta),
  );
  lastProgress = Date.now();
  savePosition({ reset: video.currentTime < 5 });
}
function updateTime() {
  const duration = video.duration;
  const progress =
    Number.isFinite(duration) && duration > 0
      ? (video.currentTime / duration) * 100
      : 0;
  $("seek").value = String(progress);
  $("seek").style.setProperty("--progress", `${progress}%`);
  $("time").replaceChildren(
    document.createTextNode(`${timeLabel(video.currentTime)} `),
    Object.assign(document.createElement("span"), { textContent: "/" }),
    document.createTextNode(` ${timeLabel(duration)}`),
  );
  if (sponsorEnabled && !video.paused && video.currentTime > ignoredUntil) {
    const segment = segments.find(
      (item) =>
        video.currentTime >= item.start && video.currentTime < item.end - 0.25,
    );
    if (segment) {
      undoPosition = video.currentTime;
      ignoredUntil = segment.end;
      video.currentTime = segment.end;
      toast(
        `Skipped ${segment.category.replaceAll("_", " ")} · ${timeLabel(segment.end - segment.start)}`,
        true,
      );
    }
  }
}
function drawMarkers() {
  $("markers").replaceChildren();
  if (
    !sponsorEnabled ||
    !Number.isFinite(video.duration) ||
    video.duration <= 0
  )
    return;
  for (const segment of segments) {
    const marker = document.createElement("i");
    marker.style.left = `${(segment.start / video.duration) * 100}%`;
    marker.style.width = `${((segment.end - segment.start) / video.duration) * 100}%`;
    $("markers").append(marker);
  }
}
function qualityLabel(track) {
  return `${track.height}p${track.frameRate > 30 ? Math.round(track.frameRate) : ""}`;
}
function updateBadge() {
  if (source?.kind === "dash") {
    const track = engine.getVariantTracks().find((item) => item.active);
    if (track) $("stream-badge").textContent = qualityLabel(track);
  }
}
function fillQualities() {
  $("quality").replaceChildren(new Option("Auto", "auto"));
  if (source.kind === "dash") {
    const tracks = engine
      .getVariantTracks()
      .filter((item) => item.height)
      .sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
    const seen = new Set();
    for (const track of tracks) {
      const key = `${track.height}:${track.frameRate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      $("quality").add(new Option(qualityLabel(track), String(track.id)));
    }
    if (settings.preferredQuality !== "auto" && tracks.length) {
      const match =
        tracks.find(
          (track) => track.height <= Number(settings.preferredQuality),
        ) ?? tracks.at(-1);
      $("quality").value = String(match.id);
      engine.configure({ abr: { enabled: false } });
      engine.selectVariantTrack(match, true);
    }
  } else {
    source.formats.forEach((format, index) =>
      $("quality").add(
        new Option(format.qualityLabel ?? `${format.height}p`, String(index)),
      ),
    );
    $("quality").value = "0";
  }
}
async function getSegments() {
  if (!settings.sponsorBlock || !api?.runtime) return;
  try {
    const result = await api.runtime.sendMessage({
      type: "SEGMENTS",
      videoId: info.videoId,
      categories: ["sponsor"],
    });
    if (!result?.ok) throw new Error(result?.error);
    segments = cleanSegments(result.data, info.duration);
    $("sponsor").title = `SponsorBlock · ${segments.length} known segments`;
    drawMarkers();
  } catch {
    $("sponsor").title =
      "SponsorBlock is unavailable. Video playback is unaffected.";
    toast("SponsorBlock is temporarily unavailable.");
  }
}

async function initialize(data) {
  info = data.info;
  settings = cleanSettings(data.settings);
  sponsorEnabled = settings.sponsorBlock;
  $("sponsor").setAttribute("aria-pressed", String(sponsorEnabled));
  $("title").textContent = String(info.title ?? "YouTube video");
  video.volume = settings.volume;
  $("volume").value = String(settings.volume);
  try {
    if (!info.explicitStart && api?.storage) {
      try {
        const saved = await readResume(
          api.storage.local,
          info.videoId,
          info.duration,
        );
        if (saved > 0) {
          info.position = saved;
          info.resumed = true;
        }
      } catch {
        /* Storage failure should never prevent playback. */
      }
    }
    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported())
      throw new Error("This browser does not support independent streaming.");
    $("loading-text").textContent = "Checking YouTube media access…";
    // A URL in playerResponse is not proof of access: n/signature/PO-token
    // restrictions often return HTTP 403, which the video tag only calls error 4.
    let verified;
    try {
      verified = await verifyMediaFormats(info.formats);
    } catch (error) {
      if (!info.backupFormats?.length)
        throw new Error(
          `${error.message}${info.providerError ? ` Independent extraction: ${info.providerError}` : ""}`,
          { cause: error },
        );
      $("loading-text").textContent = "Trying the page-resolved streams…";
      verified = await verifyMediaFormats(info.backupFormats);
    }
    verifiedFormats = verified;
    source = selectStreams({ ...info, formats: verified }, (type) =>
      type.startsWith("audio/")
        ? MediaSource.isTypeSupported(type)
        : MediaSource.isTypeSupported(type) || Boolean(video.canPlayType(type)),
    );
    $("loading-text").textContent = "Preparing your video…";
    if (source.kind === "dash") {
      engine = new shaka.Player();
      await engine.attach(video);
      engine.configure({
        streaming: {
          bufferingGoal: 30,
          rebufferingGoal: 2,
          retryParameters: { maxAttempts: 2, baseDelay: 500, timeout: 8000 },
        },
        manifest: { retryParameters: { maxAttempts: 1, timeout: 8000 } },
        abr: { defaultBandwidthEstimate: 5000000 },
      });
      engine.addEventListener("error", (event) => {
        if (
          ready &&
          !recovering &&
          event.detail?.severity === shaka.util.Error.Severity.CRITICAL
        )
          void handlePlaybackError(
            `Stream playback failed (code ${event.detail.code}). YouTube may have changed its playback requirements.`,
          );
      });
      engine.addEventListener("adaptation", updateBadge);
      engine.addEventListener("variantchanged", updateBadge);
      // All media URLs are validated before generating this local manifest.
      manifestURL = URL.createObjectURL(
        new Blob([dashManifest(source)], { type: "application/dash+xml" }),
      );
      await engine.load(
        manifestURL,
        Number.isFinite(info.position) ? info.position : 0,
        "application/dash+xml",
      );
      URL.revokeObjectURL(manifestURL);
      manifestURL = null;
    } else {
      progressive = new ProgressivePlayer(video, (error) => {
        if (ready && !recovering) fail(error.message);
      });
      await progressive.load(source.formats[0], info.position ?? 0);
      $("stream-badge").textContent = source.formats[0].qualityLabel ?? "Video";
    }
    if (failed) return;
    fillQualities();
    updateBadge();
    if (video.readyState < 2)
      await new Promise((resolve) =>
        video.addEventListener("loadeddata", resolve, { once: true }),
      );
    if (failed) return;
    ready = true;
    lastProgress = Date.now();
    $("loading").hidden = true;
    send({ type: "READY" });
    if (info.resumed) toast(`Resumed at ${timeLabel(info.position)}`);
    if (!info.paused) await play();
    else $("center-play").hidden = false;
    void getSegments();
  } catch (error) {
    await handlePlaybackError(error.message);
  }
}

window.addEventListener("message", (event) => {
  if (
    initialized ||
    event.source !== parent ||
    event.origin !== "https://www.youtube.com" ||
    event.data?.type !== "TUBEPRO_INIT" ||
    !event.ports[0] ||
    !watchId(`https://www.youtube.com/watch?v=${event.data.info?.videoId}`)
  )
    return;
  initialized = true;
  port = event.ports[0];
  port.start();
  void initialize(event.data);
});
$("original").onclick = () =>
  fail("Original player selected by the viewer.", true);
$("play").onclick = togglePlay;
$("center-play").onclick = togglePlay;
video.onclick = togglePlay;
$("back").onclick = () => seek(-10);
$("forward").onclick = () => seek(10);
$("mute").onclick = () => {
  video.muted = !video.muted;
};
$("volume").oninput = (event) => {
  video.volume = Number(event.target.value);
  video.muted = false;
};
$("volume").onchange = () => {
  if (api?.storage) void api.storage.local.set({ volume: video.volume });
};
$("seek").oninput = (event) => {
  if (Number.isFinite(video.duration)) {
    video.currentTime = (Number(event.target.value) / 100) * video.duration;
    lastProgress = Date.now();
    savePosition({ reset: video.currentTime < 5 });
  }
};
$("speed").onchange = (event) => {
  video.playbackRate = Number(event.target.value);
};
$("sponsor").onclick = () => {
  sponsorEnabled = !sponsorEnabled;
  $("sponsor").setAttribute("aria-pressed", String(sponsorEnabled));
  drawMarkers();
  if (sponsorEnabled && !segments.length) {
    settings.sponsorBlock = true;
    void getSegments();
  }
};
$("undo").onclick = () => {
  video.currentTime = undoPosition;
  $("toast").hidden = true;
};
$("quality").onchange = async (event) => {
  if (!ready || failed) return;
  if (source.kind === "dash") {
    const auto = event.target.value === "auto";
    engine.configure({ abr: { enabled: auto } });
    if (!auto) {
      const track = engine
        .getVariantTracks()
        .find((item) => String(item.id) === event.target.value);
      if (track) engine.selectVariantTrack(track, true);
    }
  } else {
    const format =
      source.formats[Number(event.target.value)] ?? source.formats[0];
    const position = video.currentTime;
    const paused = video.paused;
    lastProgress = Date.now();
    recovering = true;
    progressive?.destroy();
    try {
      progressive = new ProgressivePlayer(video, (error) => {
        if (!recovering) fail(error.message);
      });
      await progressive.load(format, position);
      if (!paused) await play();
    } catch (error) {
      fail(error.message);
    } finally {
      recovering = false;
    }
    $("stream-badge").textContent = format.qualityLabel ?? "Video";
  }
};
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shell.requestFullscreen();
  } catch {
    toast("Fullscreen is unavailable in this browser.");
  }
};
document.addEventListener("fullscreenchange", () => {
  const full = Boolean(document.fullscreenElement);
  setIcon($("fullscreen"), full ? "exitFullscreen" : "fullscreen");
  $("fullscreen").setAttribute(
    "aria-label",
    full ? "Exit fullscreen" : "Fullscreen",
  );
  wake();
});
$("pip").hidden = !document.pictureInPictureEnabled;
$("pip").onclick = async () => {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch {
    toast("Picture in picture is unavailable for this stream.");
  }
};
video.addEventListener("timeupdate", updateTime);
video.addEventListener("durationchange", drawMarkers);
video.addEventListener("error", () => {
  if (!initialized || failed || recovering) return;
  if (ready && source?.kind === "dash")
    void handlePlaybackError(
      `The browser rejected the decoded media (code ${video.error?.code ?? "unknown"}): ${video.error?.message || "unsupported media"}.`,
    );
});
async function handlePlaybackError(reason) {
  if (failed || recovering) return;
  if (!recovered && source?.kind === "dash") {
    const alternatives = verifiedFormats.filter(
      (format) =>
        format.audioQuality &&
        !format.initRange &&
        format.mimeType.startsWith("video/mp4"),
    );
    if (alternatives.length) {
      await recoverDirect(alternatives);
      return;
    }
  }
  fail(reason);
}
async function recoverDirect(formats) {
  recovered = true;
  recovering = true;
  const position = video.currentTime;
  const paused = video.paused;
  try {
    toast("Retrying with buffered MP4 playback…");
    if (engine) {
      await engine.destroy();
      engine = null;
    }
    source = {
      kind: "progressive",
      formats: formats.sort((a, b) => b.height - a.height),
    };
    progressive = new ProgressivePlayer(video, (error) => {
      if (!recovering) fail(error.message);
    });
    await progressive.load(source.formats[0], position);
    ready = true;
    $("loading").hidden = true;
    send({ type: "READY" });
    fillQualities();
    $("stream-badge").textContent = source.formats[0].qualityLabel ?? "Video";
    if (!paused) await play();
    void getSegments();
  } catch (error) {
    fail(error.message);
  } finally {
    recovering = false;
    lastProgress = Date.now();
  }
}
video.addEventListener("play", () => {
  shell.classList.add("playing");
  setIcon($("play"), "pause");
  $("play").setAttribute("aria-label", "Pause");
  $("center-play").hidden = true;
  lastProgress = Date.now();
  reportState();
  wake();
});
video.addEventListener("pause", () => {
  shell.classList.remove("playing");
  setIcon($("play"), "play");
  $("play").setAttribute("aria-label", "Play");
  if (ready) $("center-play").hidden = false;
  reportState();
  savePosition();
  wake();
});
video.addEventListener("seeked", () =>
  savePosition({ reset: video.currentTime < 5 }),
);
video.addEventListener("ended", () => {
  savePosition({ ended: true });
  toast("Video finished. Choose another video on YouTube.");
});
video.addEventListener("volumechange", () => {
  setIcon($("mute"), video.muted || video.volume === 0 ? "muted" : "volume");
  $("mute").setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
  $("volume").value = String(video.volume);
});
shell.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "BUTTON"].includes(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  const actions = {
    " ": togglePlay,
    k: togglePlay,
    j: () => seek(-10),
    l: () => seek(10),
    arrowleft: () => seek(-5),
    arrowright: () => seek(5),
    m: () => $("mute").click(),
    f: () => $("fullscreen").click(),
  };
  if (actions[key]) {
    event.preventDefault();
    actions[key]();
    wake();
  }
});
setInterval(() => {
  if (!ready || failed || recovering) return;
  reportState();
  if (Date.now() - lastSavedAt >= 5000) savePosition();
  if (
    document.visibilityState === "hidden" ||
    video.paused ||
    video.ended ||
    video.currentTime !== lastPosition
  )
    lastProgress = Date.now();
  else if (Date.now() - lastProgress > 20000)
    fail(
      "Playback stopped progressing for 20 seconds. The stream may have expired or YouTube may have changed.",
    );
  lastPosition = video.currentTime;
}, 1000);
window.addEventListener("pagehide", () => {
  savePosition();
  ready = false;
  visibility.destroy();
  progressive?.destroy();
  if (manifestURL) URL.revokeObjectURL(manifestURL);
  if (engine) void engine.destroy().catch(() => {});
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) savePosition();
});
