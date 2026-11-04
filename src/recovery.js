import { mediaURL } from "./shared.js";

export function isYouTubeSender(sender) {
  try {
    return (
      Number.isInteger(sender.tab?.id) &&
      sender.frameId === 0 &&
      new URL(sender.url).origin === "https://www.youtube.com"
    );
  } catch {
    return false;
  }
}

/** Match signed media identities, never reuse an advertisement or a previous video's URL. */
export function mergeObservedFormats(formats, observed = []) {
  return formats.map((format) => {
    let original;
    try {
      original = new URL(
        format.url ??
          new URLSearchParams(format.signatureCipher ?? "").get("url"),
      );
    } catch {
      return format;
    }
    const identity = original.searchParams.get("id");
    if (!identity) return format;
    const match = observed.toReversed().find((value) => {
      if (!mediaURL(value)) return false;
      const url = new URL(value);
      return (
        url.pathname === "/videoplayback" &&
        url.searchParams.get("id") === identity &&
        url.searchParams.get("itag") === String(format.itag) &&
        url.searchParams.get("source") === "youtube" &&
        !url.searchParams.has("sabr")
      );
    });
    if (!match) return format;
    const resolved = new URL(match);
    const signed = new Set(
      (resolved.searchParams.get("sparams") ?? "").split(","),
    );
    for (const key of ["range", "rn", "rbuf", "ump", "alr"])
      if (!signed.has(key)) resolved.searchParams.delete(key);
    return { ...format, url: resolved.href, ciphered: false, observed: true };
  });
}

/** Inspect actual media responses before handing a URL to the decoder. */
export async function verifyMediaFormats(formats, fetcher = fetch) {
  const verified = [];
  const errors = new Set();
  const budget = AbortSignal.timeout(7000);
  // Prefer URLs already transformed by YouTube's running player.
  const candidates = formats
    .filter((item) => mediaURL(item.url))
    .sort(
      (a, b) =>
        Number(Boolean(b.observed)) - Number(Boolean(a.observed)) ||
        b.bitrate - a.bitrate,
    );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (next < candidates.length && !budget.aborted) {
        const format = candidates[next++];
        try {
          const response = await fetcher(format.url, {
            headers: { Range: "bytes=0-63" },
            credentials: "omit",
            signal: AbortSignal.any([budget, AbortSignal.timeout(3500)]),
          });
          const type = response.headers.get("content-type") ?? "";
          const valid =
            response.ok &&
            /^(video\/|audio\/|application\/octet-stream)/i.test(type);
          if (response.body) await response.body.cancel();
          if (valid) verified.push(format);
          else
            errors.add(
              response.ok
                ? `unexpected media type ${type || "unknown"}`
                : `HTTP ${response.status}`,
            );
        } catch {
          errors.add("media request blocked or timed out");
        }
      }
    }),
  );
  if (!verified.length)
    throw new Error(
      `YouTube rejected the media URLs (${[...errors].join("; ") || "no direct URLs"}). A signed URL or playback token may be missing.`,
    );
  return verified;
}
