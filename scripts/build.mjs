import { build } from "esbuild";
import { zipSync, zlibSync, strToU8 } from "fflate";
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "../src/manifest.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

function png(size) {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const triangle =
        x > size * 0.39 &&
        x < size * 0.7 &&
        Math.abs(y - size * 0.5) < (size * 0.7 - x) * 0.7;
      raw.set(
        triangle
          ? [255, 255, 255, 255]
          : [
              Math.round(164 - (y / size) * 45),
              Math.round(140 - (y / size) * 48),
              238,
              255,
            ],
        i,
      );
    }
  const chunk = (name, bytes) => {
    const data = new Uint8Array(bytes.length + 12);
    const view = new DataView(data.buffer);
    view.setUint32(0, bytes.length);
    data.set(strToU8(name), 4);
    data.set(bytes, 8);
    let crc = 0xffffffff;
    for (const byte of data.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    view.setUint32(data.length - 4, (crc ^ 0xffffffff) >>> 0);
    return data;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(chunks.map((value) => Buffer.from(value)));
}

for (const target of ["chrome", "firefox"]) {
  const outdir = join(root, "dists", target);
  await mkdir(join(outdir, "icons"), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [
      "src/background.js",
      "src/content.js",
      "src/player.js",
      "src/popup.js",
    ],
    outdir,
    bundle: true,
    format: "iife",
    target: target === "chrome" ? "chrome120" : "firefox128",
    legalComments: "eof",
    logLevel: "warning",
  });
  for (const name of ["player.html", "player.css", "popup.html", "popup.css"])
    await cp(join(root, "src", name), join(outdir, name));
  await writeFile(
    join(outdir, "manifest.json"),
    JSON.stringify(manifest(target, pkg.version), null, 2),
  );
  for (const size of [48, 128])
    await writeFile(join(outdir, "icons", `${size}.png`), png(size));
  await cp(
    join(root, "node_modules/shaka-player/LICENSE"),
    join(outdir, "SHAKA-LICENSE"),
  );
  await cp(
    join(root, "node_modules/mp4box/LICENSE"),
    join(outdir, "MP4BOX-LICENSE"),
  );
  const files = {};
  for (const item of await readdir(outdir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!item.isFile()) continue;
    const absolute = join(item.parentPath, item.name);
    const name = absolute.slice(outdir.length + 1).replaceAll("\\", "/");
    files[name] = new Uint8Array(await readFile(absolute));
  }
  const archive = join(root, "dists", `tubepro-${target}-${pkg.version}.zip`);
  await writeFile(archive, zipSync(files, { level: 6 }));
  console.log(
    `Built ${target}: dists/${target}/ + dists/tubepro-${target}-${pkg.version}.zip`,
  );
}
