import { cleanSettings } from "./shared.js";
const api = globalThis.browser ?? chrome;
const keys = ["enabled", "sponsorBlock", "preferredQuality"];
async function load() {
  document.querySelector(".version").textContent =
    `v${api.runtime.getManifest().version}`;
  try {
    const settings = cleanSettings(await api.storage.local.get());
    for (const key of keys) {
      const input = document.getElementById(key);
      if (input.type === "checkbox") input.checked = settings[key];
      else input.value = settings[key];
      input.addEventListener("change", async () => {
        try {
          await api.storage.local.set({
            [key]: input.type === "checkbox" ? input.checked : input.value,
          });
          document.getElementById("status").textContent =
            document.getElementById("enabled").checked
              ? "Independent playback"
              : "Original YouTube playback";
          document.getElementById("saved").textContent =
            "Saved. Playback preferences apply to the next video.";
        } catch {
          document.getElementById("saved").textContent =
            "Could not save settings. Please try again.";
        }
      });
    }
    document.getElementById("status").textContent = settings.enabled
      ? "Independent playback"
      : "Original YouTube playback";
  } catch {
    document.getElementById("saved").textContent =
      "Could not load settings. Reopen the extension.";
  }
}
void load();
