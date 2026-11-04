export function controlsVisibility(
  shell,
  video,
  {
    delay = 1300,
    schedule = setTimeout,
    cancel = clearTimeout,
    activeElement = () => document.activeElement,
  } = {},
) {
  let timer;
  let keyboard = false;
  let dragging = false;
  let menuOpen = false;
  const hide = () => {
    cancel(timer);
    const active = activeElement();
    if (
      video.paused ||
      video.ended ||
      dragging ||
      menuOpen ||
      (keyboard && shell.contains(active) && active !== shell)
    )
      return;
    shell.classList.add("idle");
  };
  const wake = () => {
    shell.classList.remove("idle");
    cancel(timer);
    timer = schedule(hide, delay);
  };
  const pointer = () => {
    keyboard = false;
    wake();
  };
  const down = (event) => {
    dragging = true;
    menuOpen = event.target?.tagName === "SELECT" ? !menuOpen : false;
    pointer();
  };
  const up = () => {
    dragging = false;
    wake();
  };
  const key = (event) => {
    if (event.key === "Escape") menuOpen = false;
    keyboard = event.key === "Tab" || keyboard;
    wake();
  };
  const closeMenu = () => {
    menuOpen = false;
    wake();
  };
  const events = [
    [shell, "pointermove", pointer],
    [shell, "pointerdown", down],
    [shell.ownerDocument, "pointerup", up],
    [shell.ownerDocument, "pointercancel", up],
    [shell, "pointerleave", hide],
    [shell, "keydown", key],
    [shell, "focusin", wake],
    [shell, "focusout", closeMenu],
    [shell, "change", closeMenu],
    [video, "play", wake],
    [video, "pause", wake],
    [shell.ownerDocument, "fullscreenchange", pointer],
  ];
  for (const [target, name, listener] of events)
    target.addEventListener(name, listener);
  return {
    wake,
    hide,
    destroy() {
      cancel(timer);
      for (const [target, name, listener] of events)
        target.removeEventListener(name, listener);
    },
  };
}
