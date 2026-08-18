import { defineConfig, devices } from "@playwright/test";

/**
 * The UAT cases from references/UAT_CHECKLIST.md, run against a deployment.
 *
 * Separate from playwright.external-uat.config.ts on purpose. That one is a
 * smoke suite — read-only, safe against production, cheap to run often. This
 * one mutates the target and needs real accounts, so mixing them would mean
 * either running the writes too often or running the smoke checks too rarely.
 *
 * Serial by default: several cases share an activity and would otherwise race
 * each other for the same capacity.
 *
 *   UAT_USER_WEB_URL, UAT_ADMIN_WEB_URL, UAT_API_BASE_URL   target (required)
 *   UAT_ALLOW_WRITES=yes                                    opt in to writes
 *   UAT_MEMBER_EMAIL / _PASSWORD, UAT_MEMBER_2_*,
 *   UAT_ADMIN_*, UAT_STAFF_*                                actors
 *   UAT_TESTER, UAT_BACKEND_COMMIT, UAT_FRONTEND_COMMIT     evidence identity
 *
 * See e2e/uat/uat-context.ts for the production guard and the full list.
 */

const artifactDir = process.env.UAT_ARTIFACT_DIR ?? "test-results/uat";

export default defineConfig({
  testDir: "./e2e/uat",
  fullyParallel: false,
  workers: 1,
  // No retries. A retried UAT case is not evidence of anything: the checklist
  // asks for the actual outcome, and a flake that passes on the second attempt
  // is a finding, not a pass.
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  outputDir: `${artifactDir}/artifacts`,
  reporter: [
    ["line"],
    ["json", { outputFile: `${artifactDir}/uat-results.json` }],
    ["html", { outputFolder: `${artifactDir}/html`, open: "never" }],
  ],
  metadata: {
    evidence_scope: "external_uat",
    checklist: "references/UAT_CHECKLIST.md",
    writes_enabled: process.env.UAT_ALLOW_WRITES ?? "no",
    note:
      "Executable UAT evidence. Cases recorded BLOCKED need a person: they are not failures and " +
      "must not be read as passes.",
  },
  use: {
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
    proxy: process.env.UAT_PROXY_SERVER ? { server: process.env.UAT_PROXY_SERVER } : undefined,
  },
  projects: [{ name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } }],
});
