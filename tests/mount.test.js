import { test } from "node:test";
import assert from "node:assert/strict";
import { bindNative, releaseNative, syncMount } from "../src/mount.js";

function nativePlayer() {
  const properties = new Map();
  const listeners = new Set();
  const video = {
    paused: false,
    pause() {
      this.paused = true;
    },
  };
  return {
    isConnected: true,
    listeners,
    video,
    style: {
      getPropertyValue: (key) => properties.get(key)?.value ?? "",
      getPropertyPriority: (key) => properties.get(key)?.priority ?? "",
      setProperty: (key, value, priority) =>
        properties.set(key, { value, priority }),
      removeProperty: (key) => properties.delete(key),
    },
    addEventListener: (_name, fn) => listeners.add(fn),
    removeEventListener: (_name, fn) => listeners.delete(fn),
    querySelector: () => video,
    querySelectorAll: () => [video],
    getBoundingClientRect: () => ({
      left: 24,
      top: 80,
      width: 960,
      height: 540,
    }),
  };
}

test("replacing YouTube player rebinds native guards while retaining the same iframe", () => {
  const original = nativePlayer();
  const replacement = nativePlayer();
  replacement.style.setProperty("visibility", "visible", "important");
  const frame = { style: {} };
  const state = { native: original, frame, pauseNative() {} };
  bindNative(state, original);
  original.isConnected = false;
  assert.equal(
    syncMount(state, () => replacement, 100),
    true,
  );
  assert.equal(state.frame, frame);
  assert.equal(state.native, replacement);
  assert.equal(original.listeners.size, 0);
  assert.equal(original.style.getPropertyValue("visibility"), "");
  assert.equal(replacement.video.paused, true);
  assert.equal(frame.style.width, "960px");
  releaseNative(state);
  assert.equal(replacement.style.getPropertyValue("visibility"), "visible");
  assert.equal(
    replacement.style.getPropertyPriority("visibility"),
    "important",
  );
  assert.equal(replacement.listeners.size, 0);
});

test("temporary missing DOM does not trigger fallback and recovery resets the grace period", () => {
  const original = nativePlayer();
  const state = { native: original, frame: { style: {} }, pauseNative() {} };
  bindNative(state, original);
  original.isConnected = false;
  assert.equal(
    syncMount(state, () => null, 100),
    true,
  );
  assert.equal(state.frame.style.visibility, "hidden");
  assert.equal(
    syncMount(state, () => null, 4000),
    true,
  );
  assert.equal(
    syncMount(state, () => nativePlayer(), 4500),
    true,
  );
  assert.equal(state.missingSince, null);
  assert.equal(state.frame.style.visibility, "visible");
  state.native.isConnected = false;
  assert.equal(
    syncMount(state, () => null, 5000),
    true,
  );
  assert.equal(
    syncMount(state, () => null, 10001),
    false,
  );
});
