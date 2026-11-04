export function playerRequestRule(extensionURL) {
  return {
    id: 171,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Origin", operation: "remove" }],
    },
    condition: {
      initiatorDomains: [new URL(extensionURL).hostname],
      urlFilter: "|https://www.youtube.com/youtubei/v1/player?",
      resourceTypes: ["xmlhttprequest"],
    },
  };
}

export async function preparePlayerRequests(api) {
  if (!api.declarativeNetRequest?.updateSessionRules)
    throw new Error(
      "TubePro needs its network permission. Reload the updated extension.",
    );
  await api.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [171],
    addRules: [playerRequestRule(api.runtime.getURL("/"))],
  });
}
