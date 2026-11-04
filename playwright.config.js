import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 2,
  timeout: 35000,
  expect: { timeout: 15000 },
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: "list",
});
