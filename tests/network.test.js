import { test } from "node:test";
import assert from "node:assert/strict";
import { playerRequestRule, preparePlayerRequests } from "../src/network.js";
test("Origin adjustment is scoped to this extension and the player JSON endpoint", () => {
  for (const url of [
    "chrome-extension://abcdefghijklmnop/",
    "moz-extension://12345678-1234-1234-1234-123456789012/",
  ]) {
    const rule = playerRequestRule(url);
    assert.deepEqual(rule.condition.initiatorDomains, [new URL(url).hostname]);
    assert.equal(
      rule.condition.urlFilter,
      "|https://www.youtube.com/youtubei/v1/player?",
    );
    assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest"]);
    assert.deepEqual(rule.action.requestHeaders, [
      { header: "Origin", operation: "remove" },
    ]);
  }
});
test("installing the header rule replaces only TubePro own session rule", async () => {
  let installed;
  await preparePlayerRequests({
    runtime: { getURL: () => "chrome-extension://abcdefghijklmnop/" },
    declarativeNetRequest: {
      async updateSessionRules(value) {
        installed = value;
      },
    },
  });
  assert.deepEqual(installed.removeRuleIds, [171]);
  assert.equal(installed.addRules.length, 1);
  await assert.rejects(preparePlayerRequests({}), /network permission/);
});
