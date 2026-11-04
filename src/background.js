import { extractFromPage } from "./extractor.js";
import { VIDEO_ID, CATEGORIES } from "./shared.js";
import { isYouTubeSender, mergeObservedFormats } from "./recovery.js";
import {
  requestIndependentInfo,
  requestSessionInfo,
  normalizeFormats,
} from "./provider.js";
import { preparePlayerRequests } from "./network.js";
import { createResumeWriter } from "./history.js";
const api = globalThis.browser ?? chrome;
const saveResume = createResumeWriter(api.storage.local);
async function handle(message, sender) {
  if (sender.id !== api.runtime.id) throw new Error("Unknown sender.");
  if (message?.type === "SAVE_RESUME") {
    if (
      (!isYouTubeSender(sender) &&
        sender.url !== api.runtime.getURL("player.html")) ||
      !VIDEO_ID.test(message.videoId) ||
      !Number.isFinite(message.sampledAt) ||
      message.sampledAt > Date.now() + 5000
    )
      throw new Error("Invalid playback position.");
    return await saveResume(
      message.videoId,
      message.position,
      message.duration,
      {
        sampledAt: message.sampledAt,
        ended: message.ended === true,
        reset: message.reset === true,
      },
    );
  }
  if (message?.type === "RESOLVE") {
    if (!isYouTubeSender(sender) || !VIDEO_ID.test(message.videoId))
      throw new Error("Invalid video request.");
    // YouTube rejects its JSON player endpoint when Origin is an extension URL.
    // Restrict the adjustment to this extension and this exact API endpoint.
    await preparePlayerRequests(api);
    const [page, independent] = await Promise.allSettled([
      api.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [0] },
        world: "MAIN",
        func: extractFromPage,
        args: [message.videoId],
      }),
      requestIndependentInfo(message.videoId),
    ]);
    if (page.status !== "fulfilled")
      throw new Error("The current YouTube page could not be read.");
    const result = page.value;
    if (!result[0]?.result)
      throw new Error("YouTube player API is unavailable.");
    const info = result[0].result;
    info.formats = mergeObservedFormats(info.formats, info.observedURLs);
    if (independent.status === "fulfilled" && info.status === "OK") {
      info.backupFormats = info.formats;
      info.formats = independent.value.formats;
      info.sourceClient = independent.value.sourceClient;
    } else {
      info.sourceClient = "WEB";
      info.providerError =
        independent.status === "rejected"
          ? independent.reason?.message
          : "The page did not authorize playback.";
      // Only after the cookie-free client refuses the video, try the current
      // page's existing session. Never export cookies to the extension.
      if (info.status === "OK") {
        try {
          const sessionResult = await api.scripting.executeScript({
            target: { tabId: sender.tab.id, frameIds: [0] },
            world: "MAIN",
            func: requestSessionInfo,
            args: [message.videoId],
          });
          const sessionInfo = sessionResult[0]?.result;
          const formats = sessionInfo ? normalizeFormats(sessionInfo) : [];
          if (formats.some((format) => format.url)) {
            info.backupFormats = info.formats;
            info.formats = formats;
            info.sourceClient = "VISIONOS_SESSION";
          } else
            info.providerError +=
              " Session client returned no direct media URLs.";
        } catch (error) {
          info.providerError += ` ${error.message}`;
        }
      }
    }
    delete info.observedURLs;
    return info;
  }
  if (message?.type === "SEGMENTS") {
    if (
      sender.url !== api.runtime.getURL("player.html") ||
      !VIDEO_ID.test(message.videoId)
    )
      throw new Error("Invalid segment request.");
    const categories = Array.isArray(message.categories)
      ? message.categories.filter((value) => CATEGORIES.includes(value))
      : ["sponsor"];
    const url = new URL("https://sponsor.ajay.app/api/skipSegments");
    url.searchParams.set("videoID", message.videoId);
    url.searchParams.set("categories", JSON.stringify(categories));
    const response = await fetch(url, {
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return [];
    if (!response.ok)
      throw new Error("SponsorBlock is temporarily unavailable.");
    return await response.json();
  }
  throw new Error("Unknown request.");
}
api.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(
    (data) => respond({ ok: true, data }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});
