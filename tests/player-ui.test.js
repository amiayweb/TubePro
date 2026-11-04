import { test } from "node:test";
import assert from "node:assert/strict";
import { controlsVisibility } from "../src/visibility.js";
import { readResume, writeResume, resumeRecord } from "../src/history.js";

function visibilityFixture() {
  const names = new Set();
  const shell = new EventTarget();
  shell.ownerDocument = new EventTarget();
  shell.classList = {
    add: (value) => names.add(value),
    remove: (value) => names.delete(value),
  };
  shell.contains = (value) => value === button;
  const button = { tagName: "BUTTON" };
  const video = Object.assign(new EventTarget(), {
    paused: false,
    ended: false,
  });
  let callback;
  let delay;
  const controls = controlsVisibility(shell, video, {
    activeElement: () => button,
    schedule: (fn, ms) => {
      callback = fn;
      delay = ms;
      return 1;
    },
    cancel: () => {
      callback = null;
    },
  });
  return {
    shell,
    video,
    controls,
    names,
    tick() {
      const fn = callback;
      callback = null;
      fn?.();
    },
    get delay() {
      return delay;
    },
  };
}
test("pointer-focused fullscreen button does not prevent controls hiding after 1.3 seconds", () => {
  const fixture = visibilityFixture();
  fixture.shell.ownerDocument.dispatchEvent(new Event("fullscreenchange"));
  assert.equal(fixture.delay, 1300);
  fixture.tick();
  assert.ok(fixture.names.has("idle"));
  fixture.shell.dispatchEvent(new Event("pointermove"));
  assert.equal(fixture.names.has("idle"), false);
  fixture.controls.destroy();
});
test("keyboard-focused controls remain accessible; pointer use restores auto-hide", () => {
  const fixture = visibilityFixture();
  fixture.shell.dispatchEvent(
    Object.assign(new Event("keydown"), { key: "Tab" }),
  );
  fixture.tick();
  assert.equal(fixture.names.has("idle"), false);
  fixture.shell.dispatchEvent(new Event("pointermove"));
  fixture.tick();
  assert.ok(fixture.names.has("idle"));
  fixture.video.paused = true;
  fixture.video.dispatchEvent(new Event("pause"));
  fixture.tick();
  assert.equal(fixture.names.has("idle"), false);
  fixture.controls.destroy();
});
test("resume positions are saved independently and completed videos start again", async () => {
  const data = {};
  const storage = {
    async get(key) {
      return { [key]: data[key] };
    },
    async set(value) {
      Object.assign(data, value);
    },
    async remove(key) {
      delete data[key];
    },
  };
  await writeResume(storage, "zrpaakpqSK0", 813, 1050);
  await writeResume(storage, "dQw4w9WgXcQ", 90, 200);
  assert.equal(await readResume(storage, "zrpaakpqSK0", 1050), 813);
  assert.equal(await readResume(storage, "dQw4w9WgXcQ", 200), 90);
  assert.equal(await readResume(storage, "zrpaakpqSK0", 1250), 0);
  await writeResume(storage, "zrpaakpqSK0", 1048, 1050);
  assert.equal(await readResume(storage, "zrpaakpqSK0", 1050), 0);
  assert.equal(resumeRecord(NaN, 100), null);
  assert.equal(resumeRecord(3, 100), null);
});
