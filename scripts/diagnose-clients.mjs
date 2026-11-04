const id = process.argv[2];
if (!/^[\w-]{11}$/.test(id ?? "")) throw new Error("Supply a video ID.");
const profiles = [
  {
    clientName: "VISIONOS",
    clientVersion: "1.02",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
    osName: "visionOS",
    osVersion: "26.5",
  },
  {
    clientName: "WEB_EMBEDDED_PLAYER",
    clientVersion: "2.20260708.00.00",
    clientScreen: "EMBED",
  },
  { clientName: "TVHTML5", clientVersion: "7.20260707.13.00" },
  {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    clientScreen: "EMBED",
  },
];
await Promise.all(
  profiles.map(async (client) => {
    try {
      const response = await fetch(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(6000),
          body: JSON.stringify({
            context: {
              client: { ...client, hl: "en", gl: "US" },
              thirdParty: { embedUrl: `https://www.youtube.com/watch?v=${id}` },
            },
            videoId: id,
            contentCheckOk: false,
            racyCheckOk: false,
          }),
        },
      );
      const info = await response.json();
      const formats = [
        ...(info.streamingData?.adaptiveFormats ?? []),
        ...(info.streamingData?.formats ?? []),
      ];
      console.log(
        JSON.stringify({
          client: client.clientName,
          http: response.status,
          status: info.playabilityStatus?.status,
          reason: info.playabilityStatus?.reason,
          direct: formats.filter((f) => f.url).length,
          cipher: formats.filter((f) => f.signatureCipher).length,
          hls: Boolean(info.streamingData?.hlsManifestUrl),
        }),
      );
    } catch (error) {
      console.log(client.clientName, error.message);
    }
  }),
);
