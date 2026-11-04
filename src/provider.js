import { VIDEO_ID } from "./shared.js";

export function normalizeFormats(info) {
  return [
    ...(info.streamingData?.adaptiveFormats ?? []),
    ...(info.streamingData?.formats ?? []),
  ]
    .slice(0, 150)
    .map((format) => ({
      itag: format.itag,
      url: format.url,
      mimeType: format.mimeType,
      bitrate: format.bitrate,
      width: format.width,
      height: format.height,
      fps: format.fps,
      qualityLabel: format.qualityLabel,
      initRange: format.initRange,
      indexRange: format.indexRange,
      audioQuality: format.audioQuality,
      audioSampleRate: format.audioSampleRate,
      audioChannels: format.audioChannels,
      audioTrack: format.audioTrack,
      ciphered: Boolean(format.signatureCipher || format.cipher),
    }));
}

/** Serialized into MAIN world. Cookies remain inside YouTube; only media metadata returns. */
export async function requestSessionInfo(videoId) {
  if (
    location.origin !== "https://www.youtube.com" ||
    location.pathname !== "/watch" ||
    new URL(location.href).searchParams.get("v") !== videoId
  )
    throw new Error("The requested video is no longer open.");
  const nativeContext = window.ytcfg?.get?.("INNERTUBE_CONTEXT");
  const visitorData =
    nativeContext?.client?.visitorData ?? window.ytcfg?.get?.("VISITOR_DATA");
  const response = await fetch("/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "101",
      "X-YouTube-Client-Version": "1.02",
      ...(typeof visitorData === "string"
        ? { "X-Goog-Visitor-Id": visitorData }
        : {}),
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "VISIONOS",
          clientVersion: "1.02",
          deviceMake: "Apple",
          deviceModel: "RealityDevice17,1",
          osName: "visionOS",
          osVersion: "26.5",
          hl: nativeContext?.client?.hl ?? "en",
          gl: nativeContext?.client?.gl ?? "US",
          ...(typeof visitorData === "string" ? { visitorData } : {}),
        },
        ...(nativeContext?.user ? { user: nativeContext.user } : {}),
      },
      videoId,
      contentCheckOk: false,
      racyCheckOk: false,
    }),
  });
  if (!response.ok)
    throw new Error(`Session player request failed (HTTP ${response.status}).`);
  const info = await response.json();
  const status = info.playabilityStatus?.status;
  if (status !== "OK")
    throw new Error(
      `YouTube session ${String(status ?? "UNKNOWN")}: ${String(info.playabilityStatus?.reason ?? "No reason returned").slice(0, 300)}`,
    );
  if (info.videoDetails?.videoId !== videoId)
    throw new Error("The session client returned a different video.");
  // Deliberately omit cookies, visitor identity, account data and response tracking fields.
  return {
    streamingData: {
      adaptiveFormats: info.streamingData?.adaptiveFormats ?? [],
      formats: info.streamingData?.formats ?? [],
    },
  };
}

/** Independent client response, isolated from the WEB client's restricted URLs.
 * Client profile: yt-dlp's public VISIONOS adapter. No cookies or account tokens.
 */
export async function requestIndependentInfo(videoId, fetcher = fetch) {
  if (!VIDEO_ID.test(videoId)) throw new Error("Invalid video ID.");
  const response = await fetcher(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "101",
        "X-YouTube-Client-Version": "1.02",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "VISIONOS",
            clientVersion: "1.02",
            deviceMake: "Apple",
            deviceModel: "RealityDevice17,1",
            osName: "visionOS",
            osVersion: "26.5",
            hl: "en",
            gl: "US",
          },
        },
        videoId,
        contentCheckOk: false,
        racyCheckOk: false,
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Independent player request failed (HTTP ${response.status}).`,
    );
  const info = await response.json();
  if (info.playabilityStatus?.status !== "OK") {
    const status = String(info.playabilityStatus?.status ?? "UNKNOWN");
    const reason = String(
      info.playabilityStatus?.reason ??
        info.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason
          ?.simpleText ??
        "No reason returned",
    ).slice(0, 300);
    throw new Error(`Independent client ${status}: ${reason}`);
  }
  if (info.videoDetails?.videoId !== videoId)
    throw new Error("The independent client returned a different video.");
  const formats = normalizeFormats(info);
  if (!formats.some((format) => format.url))
    throw new Error("The independent client returned no direct media URLs.");
  return { formats, sourceClient: "VISIONOS" };
}
