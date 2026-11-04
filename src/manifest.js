export function manifest(target, version) {
  return {
    manifest_version: 3,
    name: "TubePro",
    version,
    description:
      "An independent player for YouTube with quality controls, SponsorBlock, and automatic original-player fallback.",
    permissions: [
      "storage",
      "scripting",
      "declarativeNetRequestWithHostAccess",
    ],
    host_permissions: [
      "https://www.youtube.com/*",
      "https://*.googlevideo.com/*",
      "https://sponsor.ajay.app/*",
    ],
    background:
      target === "firefox"
        ? { scripts: ["background.js"] }
        : { service_worker: "background.js" },
    action: {
      default_popup: "popup.html",
      default_title: "TubePro",
      default_icon: { 48: "icons/48.png", 128: "icons/128.png" },
    },
    icons: { 48: "icons/48.png", 128: "icons/128.png" },
    content_scripts: [
      {
        matches: ["https://www.youtube.com/*"],
        js: ["content.js"],
        run_at: "document_idle",
      },
    ],
    web_accessible_resources: [
      {
        resources: ["player.html", "player.js", "player.css"],
        matches: ["https://www.youtube.com/*"],
      },
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src blob: https://www.youtube.com https://*.googlevideo.com https://sponsor.ajay.app; media-src https://*.googlevideo.com blob:; img-src 'self' data:; style-src 'self' 'unsafe-inline';",
    },
    ...(target === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "tubepro@tubepro.local",
              strict_min_version: "128.0",
              data_collection_permissions: {
                required: ["websiteContent"],
                optional: [],
              },
            },
          },
        }
      : { minimum_chrome_version: "120" }),
  };
}
