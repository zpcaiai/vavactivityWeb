import { defineConfig, devices } from "@playwright/test";

const artifactDir = process.env.UAT_ARTIFACT_DIR ?? "test-results/external-uat";

/**
 * Proxy selection, validated at config load so a typo fails immediately with
 * an explanation instead of surfacing as a wall of transport errors.
 *
 *   E2E_PROXY_SERVER=http://127.0.0.1:7890   route through that proxy
 *   E2E_PROXY_SERVER=none                    ignore any system proxy
 *   unset                                    let Chromium do whatever the OS says
 */
const rawProxy = process.env.E2E_PROXY_SERVER?.trim() ?? "";
const bypassAllProxies = ["none", "direct", "direct://", "off"].includes(rawProxy.toLowerCase());
const proxyServer = bypassAllProxies ? undefined : rawProxy || undefined;
if (proxyServer && !/^(https?|socks[45]?):\/\/[^/]+/i.test(proxyServer)) {
  throw new Error(
    `E2E_PROXY_SERVER must be a proxy URL such as http://127.0.0.1:7890, or "none" ` +
      `to ignore the system proxy. Received: ${proxyServer}`,
  );
}

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
    //
    // `proxy` here also applies to APIRequestContext, so a bad value takes the
    // Node-side API checks down with the browser ones. A first attempt passed
    // `direct://` as the server and did exactly that: fourteen failures, four
    // of them in checks that had been passing. Hence the validation below and
    // the separate switch for "no proxy at all", which is a Chromium launch
    // flag rather than a proxy address.
    proxy: proxyServer ? { server: proxyServer, bypass: process.env.E2E_PROXY_BYPASS } : undefined,
    launchOptions: bypassAllProxies ? { args: ["--no-proxy-server"] } : undefined,
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
