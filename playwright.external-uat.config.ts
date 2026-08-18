import { defineConfig, devices } from "@playwright/test";

const artifactDir = process.env.UAT_ARTIFACT_DIR ?? "test-results/external-uat";

export default defineConfig({
  testDir: "./e2e/external-uat",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: `${artifactDir}/artifacts`,
  reporter: [
    ["line"],
    ["json", { outputFile: `${artifactDir}/playwright-results.json` }],
    ["html", { outputFolder: `${artifactDir}/html`, open: "never" }]
  ],
  metadata: {
    evidence_scope: process.env.UAT_EVIDENCE_SCOPE ?? "local_compose",
    physical_device: "NOT_EVALUATED",
    note: "Desktop Chrome and Pixel 7 emulation are executable UAT evidence; neither proves physical-device or production UAT."
  },
  use: {
    // Playwright does not read HTTPS_PROXY for browser launches, so a runner
    // behind a proxy silently fails at the transport layer and looks like a
    // broken deployment. Passing it explicitly is the difference between a
    // diagnosable run and a misleading one.
    proxy: process.env.E2E_PROXY_SERVER
      ? { server: process.env.E2E_PROXY_SERVER, bypass: process.env.E2E_PROXY_BYPASS }
      : undefined,
    trace: "on",
    screenshot: "on",
    navigationTimeout: 30_000,
    actionTimeout: 15_000
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome"
      }
    },
    {
      name: "mobile-chrome-pixel-7-emulation",
      use: {
        ...devices["Pixel 7"],
        channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome"
      }
    }
  ]
});
