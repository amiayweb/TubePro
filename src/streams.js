import { mediaURL } from "./shared.js";
const xml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
const integer = (value) =>
  Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const range = (value) =>
  value &&
  integer(value.start) &&
  integer(value.end) &&
  Number(value.end) >= Number(value.start);
const mime = (value) =>
  /^(video|audio)\/(mp4|webm);\s*codecs="([a-zA-Z0-9., -]+)"$/.exec(
    value ?? "",
  );

/** Direct formats only. Ciphered, live, SABR-only and unsupported streams fail closed. */
export function selectStreams(info, supported = () => true) {
  if (info?.status !== "OK")
    throw new Error("YouTube did not authorize independent playback.");
  if (
    info.live ||
    !Number.isFinite(info.duration) ||
    info.duration <= 0 ||
    info.duration > 604800
  )
    throw new Error(
      "This live or unbounded stream needs the original YouTube player.",
    );
  const formats = (Array.isArray(info.formats) ? info.formats : [])
    .slice(0, 150)
    .filter(
      (format) =>
        mediaURL(format.url) &&
        mime(format.mimeType) &&
        supported(format.mimeType) &&
        Number.isFinite(format.bitrate) &&
        format.bitrate > 0,
    );
  const adaptive = formats.filter(
    (format) => range(format.initRange) && range(format.indexRange),
  );
  const videos = adaptive.filter(
    (format) =>
      format.mimeType.startsWith("video/") &&
      integer(format.width) &&
      integer(format.height) &&
      format.width > 0 &&
      format.height > 0,
  );
  const audioFormats = adaptive.filter((format) =>
    format.mimeType.startsWith("audio/"),
  );
  const defaultAudio = audioFormats.filter(
    (format) => !format.audioTrack || format.audioTrack.audioIsDefault,
  );
  const audios = (defaultAudio.length ? defaultAudio : audioFormats)
    .sort((a, b) => b.bitrate - a.bitrate)
    .slice(0, 1);
  if (videos.length && audios.length)
    return { kind: "dash", videos, audios, duration: info.duration };
  const progressive = formats
    .filter(
      (format) =>
        format.audioQuality &&
        !format.initRange &&
        format.mimeType.startsWith("video/"),
    )
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  if (progressive.length)
    return {
      kind: "progressive",
      formats: progressive,
      duration: info.duration,
    };
  throw new Error(
    "No compatible direct streams. YouTube may require a newer client, signature, or playback token.",
  );
}

export function dashManifest(streams) {
  const representation = (format) => {
    const parsed = mime(format.mimeType);
    const video = parsed[1] === "video";
    return `<Representation id="${xml(format.itag)}" bandwidth="${Math.round(format.bitrate)}" codecs="${xml(parsed[3])}"${video ? ` width="${Number(format.width)}" height="${Number(format.height)}"${Number.isFinite(format.fps) && format.fps > 0 ? ` frameRate="${format.fps}"` : ""}` : ""}><BaseURL>${xml(mediaURL(format.url))}</BaseURL><SegmentBase indexRange="${Number(format.indexRange.start)}-${Number(format.indexRange.end)}" indexRangeExact="true"><Initialization range="${Number(format.initRange.start)}-${Number(format.initRange.end)}"/></SegmentBase></Representation>`;
  };
  const sets = [];
  for (const type of ["video", "audio"]) {
    const formats = type === "video" ? streams.videos : streams.audios;
    for (const container of ["mp4", "webm"]) {
      const group = formats.filter((format) =>
        format.mimeType.startsWith(`${type}/${container};`),
      );
      if (group.length)
        sets.push(
          `<AdaptationSet mimeType="${type}/${container}" contentType="${type}" segmentAlignment="true">${group.map(representation).join("")}</AdaptationSet>`,
        );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT${streams.duration}S" minBufferTime="PT2S"><Period duration="PT${streams.duration}S">${sets.join("")}</Period></MPD>`;
}
