import { cleanSettings, watchId } from "./shared.js";
import { bindNative, releaseNative, syncMount } from "./mount.js";
const api = globalThis.browser ?? chrome;
let session = null;
let currentId = null;
let generation = 0;
let enabled = true;
let notice = null;
const frameURL = api.runtime.getURL("player.html");
const frameAddress = new URL(frameURL);
const frameOrigin = `${frameAddress.protocol}//${frameAddress.host}`;

function showNotice(reason, fallback = true) {
  notice?.remove();
  const host = document.createElement("div");
  host.id = "tubepro-notice";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>:host{position:fixed;bottom:24px;right:24px;z-index:2147483647;max-width:min(440px,calc(100vw - 32px));font:14px/1.5 system-ui;color:#edf3ff}article{background:#151c2b;border:1px solid #35435e;border-radius:16px;padding:18px;box-shadow:0 12px 50px #0008}strong{display:block;font-size:15px;margin-bottom:6px}p{margin:0;color:#bdc8dd}footer{display:flex;gap:10px;margin-top:14px}button{font:inherit;color:#fff;background:#2a3750;border:1px solid #526485;border-radius:8px;padding:7px 12px;cursor:pointer}button:focus-visible{outline:2px solid #a3b8ff}details{margin-top:8px;color:#9eacc5;font-size:12px}</style><article role="status"><strong></strong><p></p><details><summary>Technical details</summary><span></span></details><footer><button id="retry">Try TubePro again</button><button id="dismiss">Dismiss</button></footer></article>`;
  root.querySelector("strong").textContent = fallback
    ? "TubePro · Original player restored"
    : "TubePro · YouTube player";
  root.querySelector("p").textContent = fallback
    ? /not a bot|LOGIN_REQUIRED/i.test(String(reason))
      ? "YouTube requires verification or sign-in for independent playback of this video. TubePro could not obtain a usable stream. The original YouTube player has been restored."
      : "TubePro could not play this video. A YouTube update may have changed third-party playback. You are now using the original YouTube player."
    : "You switched to the original YouTube player.";
  root.querySelector("span").textContent =
    `TubePro ${api.runtime.getManifest().version} · Video ${watchId(location.href) ?? "unknown"} · ${String(reason).slice(0, 900)}`;
  root.querySelector("#dismiss").onclick = () => host.remove();
  root.querySelector("#retry").onclick = () => {
    host.remove();
    currentId = null;
    void navigate();
  };
  document.documentElement.append(host);
  notice = host;
}

function restore({ resume = true, position } = {}) {
  const old = session;
  session = null;
  if (!old) return;
  if (
    old.ready &&
    Number.isFinite(old.duration) &&
    Number.isFinite(old.sampledAt)
  )
    void api.runtime
      .sendMessage({
        type: "SAVE_RESUME",
        videoId: old.videoId,
        position: old.position,
        duration: old.duration,
        sampledAt: old.sampledAt,
      })
      .catch(() => {});
  clearTimeout(old.deadline);
  clearInterval(old.guard);
  cancelAnimationFrame(old.layoutFrame);
  old.port?.close();
  old.frame?.remove();
  releaseNative(old);
  const video = old.native.querySelector("video");
  if (resume && video && watchId(location.href) === old.videoId) {
    const point = Number.isFinite(position) ? position : old.position;
    // Do not seek a native advertisement to a content timestamp.
    if (
      !old.native.classList.contains("ad-showing") &&
      Number.isFinite(point) &&
      point > 0 &&
      video.duration > point
    )
      video.currentTime = point;
    if (!old.paused) void video.play().catch(() => {});
  }
}

function fallback(reason, manual = false) {
  if (!session) return;
  restore();
  showNotice(reason, !manual);
}

async function waitForNative(id, ticket) {
  const deadline = Date.now() + 8000;
  while (
    Date.now() < deadline &&
    ticket === generation &&
    watchId(location.href) === id
  ) {
    const player =
      document.querySelector("ytd-watch-flexy #movie_player") ??
      document.getElementById("movie_player");
    if (player?.parentElement && player.querySelector("video")) return player;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function navigate() {
  const id = watchId(location.href);
  if (id === currentId) return;
  currentId = id;
  const ticket = ++generation;
  restore({ resume: false });
  notice?.remove();
  if (!id || !enabled) return;
  let settings;
  try {
    settings = cleanSettings(await api.storage.local.get());
  } catch {
    return;
  }
  if (!settings.enabled || ticket !== generation) return;
  const native = await waitForNative(id, ticket);
  if (!native || ticket !== generation) return;
  const originalVideo = native.querySelector("video");
  const old = {
    videoId: id,
    native,
    position: originalVideo.currentTime,
    paused: originalVideo.paused,
    visibility: {
      value: native.style.getPropertyValue("visibility"),
      priority: native.style.getPropertyPriority("visibility"),
    },
    hidden: false,
  };
  session = old;
  old.deadline = setTimeout(() => {
    if (session === old)
      fallback("Independent playback did not become ready within 18 seconds.");
  }, 18000);
  try {
    const result = await api.runtime.sendMessage({
      type: "RESOLVE",
      videoId: id,
    });
    if (session !== old || ticket !== generation) return;
    if (!result?.ok)
      throw new Error(result?.error ?? "The playback service is unavailable.");
    clearTimeout(old.deadline);
    old.deadline = setTimeout(() => {
      if (session === old)
        fallback(
          "The player did not become ready within 18 seconds after stream extraction.",
        );
    }, 18000);
    old.position = originalVideo.currentTime;
    old.paused = originalVideo.paused;
    result.data.position = old.position;
    result.data.paused = old.paused;
    result.data.explicitStart =
      new URL(location.href).searchParams.has("t") ||
      new URL(location.href).searchParams.has("start");
    const frame = document.createElement("iframe");
    old.frame = frame;
    frame.title = "TubePro video player";
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.style.cssText =
      "position:fixed;border:0;z-index:2000;background:#090c13;color-scheme:dark;visibility:hidden;";
    frame.onload = () => {
      if (session !== old) return;
      const channel = new MessageChannel();
      old.port = channel.port1;
      old.port.onmessage = (event) => {
        if (session !== old || watchId(location.href) !== id) return;
        const message = event.data;
        if (message?.type === "READY") {
          clearTimeout(old.deadline);
          old.ready = true;
        }
        if (message?.type === "STATE") {
          if (Number.isFinite(message.position) && message.position >= 0)
            old.position = message.position;
          if (typeof message.paused === "boolean") old.paused = message.paused;
          if (Number.isFinite(message.duration) && message.duration > 0)
            old.duration = message.duration;
          if (Number.isFinite(message.sampledAt))
            old.sampledAt = message.sampledAt;
        }
        if (message?.type === "FALLBACK")
          fallback(
            message.reason ?? "Playback failed.",
            message.manual === true,
          );
      };
      frame.contentWindow.postMessage(
        { type: "TUBEPRO_INIT", info: result.data, settings },
        frameOrigin,
        [channel.port2],
      );
    };
    frame.src = frameURL;
    old.pauseNative = (event) => {
      if (event.target instanceof HTMLVideoElement) event.target.pause();
    };
    // Never put the iframe into a subtree owned by YouTube. Removing/reparenting
    // an iframe destroys its browsing context and interrupts playback.
    document.documentElement.append(frame);
    bindNative(old, native);
    const updateLayout = () => {
      if (session !== old) return;
      if (watchId(location.href) !== id) {
        void navigate();
        return;
      }
      if (
        !syncMount(
          old,
          () =>
            document.querySelector("ytd-watch-flexy #movie_player") ??
            document.getElementById("movie_player"),
          performance.now(),
        )
      ) {
        fallback(
          "The YouTube video area has been unavailable for more than 5 seconds.",
        );
        return;
      }
      old.layoutFrame = requestAnimationFrame(updateLayout);
    };
    updateLayout();
    old.guard = setInterval(() => {
      for (const video of old.native.querySelectorAll("video"))
        if (!video.paused) video.pause();
    }, 500);
  } catch (error) {
    if (session === old) fallback(error.message);
  }
}

document.addEventListener("yt-navigate-start", () => {
  ++generation;
  currentId = null;
  restore({ resume: false });
  notice?.remove();
});
document.addEventListener("yt-navigate-finish", () => {
  void navigate();
});
window.addEventListener("popstate", () => {
  void navigate();
});
setInterval(() => {
  void navigate();
}, 1000);
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.enabled) return;
  void api.storage.local.get().then((value) => {
    enabled = cleanSettings(value).enabled;
    if (!enabled) {
      ++generation;
      restore();
      currentId = null;
      notice?.remove();
    } else if (!session) {
      currentId = null;
      void navigate();
    }
  });
});
void navigate();
