import { requestIndependentInfo } from "../src/provider.js";
import { verifyMediaFormats } from "../src/recovery.js";
const videoId = process.argv[2] ?? "dQw4w9WgXcQ";
try {
  const info = await requestIndependentInfo(videoId);
  const samples = ["video/mp4", "audio/mp4"]
    .map((type) =>
      info.formats.find(
        (format) => format.url && format.mimeType?.startsWith(type),
      ),
    )
    .filter(Boolean);
  const verified = await verifyMediaFormats(samples);
  const types = new Set(
    verified.map((format) => format.mimeType.split(";")[0]),
  );
  console.log(
    JSON.stringify(
      {
        client: info.sourceClient,
        returnedFormats: info.formats.length,
        verifiedMedia: [...types],
      },
      null,
      2,
    ),
  );
  if (!types.has("video/mp4") || !types.has("audio/mp4")) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
