import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/admin-routes",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 16 * 60_000,
  expect: { timeout: 12_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome"
  },
  outputDir: "test-results/admin-audit"
});
