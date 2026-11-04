import { requestIndependentInfo } from "../src/provider.js";
const info = await requestIndependentInfo(process.argv[2] ?? "dQw4w9WgXcQ");
const format = info.formats.find(
  (item) => item.url && item.mimeType.startsWith("video/mp4"),
);
const browserUA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
for (const [name, extra] of Object.entries({
  baseline: {},
  browserWithoutOrigin: { "User-Agent": browserUA },
  extension: {
    Origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "User-Agent": browserUA,
  },
  firefox: {
    Origin: "moz-extension://12345678-1234-1234-1234-123456789012",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  },
})) {
  try {
    const candidate = await requestIndependentInfo(
      process.argv[2] ?? "dQw4w9WgXcQ",
      (url, options) =>
        fetch(url, { ...options, headers: { ...options.headers, ...extra } }),
    );
    const sample = candidate.formats.find(
      (item) => item.url && item.mimeType.startsWith("video/mp4"),
    );
    const response = await fetch(sample.url, {
      headers: { Range: "bytes=0-63", ...extra },
      signal: AbortSignal.timeout(5000),
    });
    console.log(`API + media (${name}): HTTP ${response.status}`);
    await response.body?.cancel();
  } catch (error) {
    console.log(`API + media (${name}): ${error.message}`);
  }
}
for (const [name, headers] of Object.entries({
  baseline: {},
  browser: { "User-Agent": browserUA },
  extension: {
    "User-Agent": browserUA,
    Origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  youtube: {
    "User-Agent": browserUA,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
  },
})) {
  try {
    const response = await fetch(format.url, {
      headers: { Range: "bytes=0-63", ...headers },
      signal: AbortSignal.timeout(5000),
    });
    console.log(`${name}: HTTP ${response.status}`);
    await response.body?.cancel();
  } catch {
    console.log(`${name}: request failed`);
  }
}
