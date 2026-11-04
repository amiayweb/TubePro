/** Keep the extension frame outside YouTube's frequently replaced player subtree. */
export function releaseNative(state) {
  if (!state.native) return;
  state.native.removeEventListener("play", state.pauseNative, true);
  if (state.hidden) {
    if (state.visibility.value)
      state.native.style.setProperty(
        "visibility",
        state.visibility.value,
        state.visibility.priority,
      );
    else state.native.style.removeProperty("visibility");
  }
  state.hidden = false;
}

export function bindNative(state, native) {
  releaseNative(state);
  state.native = native;
  state.visibility = {
    value: native.style.getPropertyValue("visibility"),
    priority: native.style.getPropertyPriority("visibility"),
  };
  native.addEventListener("play", state.pauseNative, true);
  native.style.setProperty("visibility", "hidden", "important");
  state.hidden = true;
  for (const video of native.querySelectorAll("video"))
    if (!video.paused) video.pause();
}

/** A short missing-DOM interval is normal during YouTube layout updates. */
export function syncMount(state, findNative, now) {
  if (!state.native.isConnected) {
    const replacement = findNative();
    if (replacement?.isConnected && replacement.querySelector("video")) {
      bindNative(state, replacement);
      state.missingSince = null;
    } else {
      state.missingSince ??= now;
      state.frame.style.visibility = "hidden";
      return now - state.missingSince < 5000;
    }
  }
  state.missingSince = null;
  const bounds = state.native.getBoundingClientRect();
  state.frame.style.visibility =
    bounds.width > 0 && bounds.height > 0 ? "visible" : "hidden";
  const geometry = `${bounds.left},${bounds.top},${bounds.width},${bounds.height}`;
  if (state.geometry !== geometry) {
    state.geometry = geometry;
    Object.assign(state.frame.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
  }
  return true;
}
