/** Runs in the page's MAIN world. Keep self-contained: scripting serializes this function. */
export async function extractFromPage(videoId) {
  // MessageSender.url can refer to the original document after SPA navigation.
  // Validate the LIVE URL here, in the actual top-level document instead.
  if (
    location.origin !== "https://www.youtube.com" ||
    location.pathname !== "/watch" ||
    new URL(location.href).searchParams.get("v") !== videoId
  )
    throw new Error("The requested video is no longer open.");
  const matches = (response) => response?.videoDetails?.videoId === videoId;
  const player = document.getElementById("movie_player");
  let response;
  try {
    response = player?.getPlayerResponse?.();
  } catch {
    /* API may change. */
  }
  for (let attempt = 0; !matches(response) && attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      response = player?.getPlayerResponse?.();
    } catch {
      /* Player is transitioning. */
    }
  }
  if (!matches(response) && matches(window.ytInitialPlayerResponse))
    response = window.ytInitialPlayerResponse;
  const candidates = matches(response) ? [response] : [];
  if (
    !candidates.some((item) =>
      [
        ...(item.streamingData?.adaptiveFormats ?? []),
        ...(item.streamingData?.formats ?? []),
      ].some((format) => format.url),
    )
  ) {
    try {
      const context = window.ytcfg?.get?.("INNERTUBE_CONTEXT");
      if (context?.client) {
        const fresh = await fetch("/youtubei/v1/player?prettyPrint=false", {
          method: "POST",
          credentials: "same-origin",
          signal: AbortSignal.timeout(7000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: context.client },
            videoId,
            contentCheckOk: false,
            racyCheckOk: false,
          }),
        });
        if (fresh.ok) {
          const body = await fresh.json();
          if (matches(body)) candidates.unshift(body);
        }
      }
    } catch {
      /* Caller owns the bounded native fallback. */
    }
  }
  const selected =
    candidates.find((item) =>
      item.streamingData?.adaptiveFormats?.some((format) => format.url),
    ) ??
    candidates.find((item) =>
      item.streamingData?.formats?.some((format) => format.url),
    ) ??
    candidates[0];
  if (!selected)
    throw new Error("YouTube did not expose a matching player response.");
  const formats = [
    ...(selected.streamingData?.adaptiveFormats ?? []),
    ...(selected.streamingData?.formats ?? []),
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
      signatureCipher: format.signatureCipher ?? format.cipher,
    }));
  let position = 0;
  let paused = false;
  try {
    position = player?.getCurrentTime?.() ?? 0;
    paused = player?.getPlayerState?.() === 2;
  } catch {
    /* Optional resume metadata. */
  }
  return {
    observedURLs: performance
      .getEntriesByType("resource")
      .slice(-500)
      .map((entry) => entry.name)
      .filter((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            url.hostname.endsWith(".googlevideo.com") &&
            url.pathname === "/videoplayback"
          );
        } catch {
          return false;
        }
      }),
    videoId,
    title: String(selected.videoDetails?.title ?? "YouTube video").slice(
      0,
      500,
    ),
    duration: Number(selected.videoDetails?.lengthSeconds),
    live: Boolean(selected.videoDetails?.isLiveContent),
    status: selected.playabilityStatus?.status,
    reason: selected.playabilityStatus?.reason,
    formats,
    position,
    paused,
  };
}
