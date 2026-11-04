export const DEFAULTS = Object.freeze({
  enabled: true,
  sponsorBlock: true,
  preferredQuality: "auto",
  volume: 0.8,
});
export const CATEGORIES = [
  "sponsor",
  "selfpromo",
  "interaction",
  "intro",
  "outro",
  "preview",
  "music_offtopic",
  "filler",
];
export const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
export function watchId(url) {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("v");
    return parsed.origin === "https://www.youtube.com" &&
      parsed.pathname === "/watch" &&
      VIDEO_ID.test(id ?? "")
      ? id
      : null;
  } catch {
    return null;
  }
}
export function mediaURL(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".googlevideo.com") ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function cleanSettings(value = {}) {
  return {
    enabled:
      typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
    sponsorBlock:
      typeof value.sponsorBlock === "boolean"
        ? value.sponsorBlock
        : DEFAULTS.sponsorBlock,
    preferredQuality: ["auto", "720", "1080", "1440", "2160", "4320"].includes(
      value.preferredQuality,
    )
      ? value.preferredQuality
      : "auto",
    volume: Number.isFinite(value.volume)
      ? Math.max(0, Math.min(1, value.volume))
      : DEFAULTS.volume,
  };
}
export function cleanSegments(items, duration = Infinity) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (item) =>
        CATEGORIES.includes(item.category) &&
        (item.actionType == null || item.actionType === "skip") &&
        Array.isArray(item.segment) &&
        item.segment.length === 2 &&
        item.segment.every(Number.isFinite) &&
        item.segment[0] >= 0 &&
        item.segment[1] > item.segment[0] &&
        item.segment[1] <= duration + 1,
    )
    .map((item) => ({
      category: item.category,
      start: item.segment[0],
      end: item.segment[1],
    }))
    .sort((a, b) => a.start - b.start)
    .slice(0, 500);
}
export function timeLabel(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  return `${hours ? `${hours}:` : ""}${hours ? String(Math.floor(total / 60) % 60).padStart(2, "0") : Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
