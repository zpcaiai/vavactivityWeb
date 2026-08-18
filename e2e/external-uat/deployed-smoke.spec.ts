import { expect, test, type Page } from "@playwright/test";

/**
 * Gate G4 — the deployed environment, not a local one.
 *
 * `browser-device-uat.spec.ts` defaults to 127.0.0.1 and proves the build
 * works. It cannot prove the *deployment* works, and the two have failed
 * apart in practice: a cold-starting API returned an error page with no CORS
 * headers, and a stale `index.html` asked for chunk hashes the deploy had
 * already replaced. Neither is reachable from a localhost run.
 *
 * So this file only ever runs against real URLs, refuses to run against
 * localhost, and asserts the things that are specifically true of a
 * deployment: the API answers, its readiness names its dependencies, CORS
 * admits the deployed origin, and the shipped bundle is internally
 * consistent.
 *
 * It is a smoke suite, not human UAT. Passing it means the deployment is
 * reachable and coherent; it does not make the release UAT_READY, which still
 * needs a person to run the scenarios in references/UAT_CHECKLIST.md.
 *
 * A proxy note, learned the hard way: Chromium does not use HTTPS_PROXY, and a
 * system proxy that curl handles fine can still close the browser's
 * connections. If every page test fails with ERR_CONNECTION_CLOSED while the
 * API tests pass, that is the browser's network path, not the deployment —
 * set E2E_PROXY_SERVER (`direct://` to force no proxy at all).
 *
 *   E2E_USER_WEB_URL=https://…  \
 *   E2E_ADMIN_WEB_URL=https://…/admin \
 *   E2E_API_BASE_URL=https://…/api/v1 \
 *   pnpm exec playwright test --config playwright.external-uat.config.ts \
 *     e2e/external-uat/deployed-smoke.spec.ts
 */

const userWebUrl = process.env.E2E_USER_WEB_URL ?? "";
const adminWebUrl = process.env.E2E_ADMIN_WEB_URL ?? "";
const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "";

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
}

test.beforeAll(() => {
  const missing = [
    ["E2E_USER_WEB_URL", userWebUrl],
    ["E2E_ADMIN_WEB_URL", adminWebUrl],
    ["E2E_API_BASE_URL", apiBaseUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `External UAT needs real URLs; missing ${missing.join(", ")}. ` +
        "Running this suite without them would produce local evidence labelled as external.",
    );
  }
  // Refusing localhost is the whole point: E4 evidence gathered against a dev
  // server is the "mock/sandbox evidence presented as live" blocker.
  const local = [userWebUrl, adminWebUrl, apiBaseUrl].filter(isLocal);
  if (local.length) {
    throw new Error(`External UAT cannot target localhost: ${local.join(", ")}`);
  }
});

// The config's per-test timeout is 60s, but a suspended instance can take
// longer than that to answer at all — and the request timeouts below, plus the
// navigation retry budget further down, are deliberately larger than 60s.
// Without raising the test timeout to match, the test is killed mid-request:
// the failure arrives as an empty AggregateError, and Playwright tears down the
// worker so every remaining test reports "did not run". The cold-start
// tolerance this suite is built around cannot work inside a shorter budget
// than the waits it performs.
test.describe.configure({ timeout: 240_000 });

test.describe("deployed API", () => {
  test("liveness answers and identifies the application", async ({ request }) => {
    const response = await request.get(`${apiBaseUrl}/health/live`, { timeout: 120_000 });
    expect(response.status(), "a suspended instance answers with the platform's error page").toBe(200);
    // Liveness passing while readiness fails is the exact split this suite
    // exists to make visible, so the two are asserted separately on purpose.
    const body = await response.json();
    expect(body?.data?.status).toBe("ok");
    // The application, not a proxy, produced this.
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("readiness names each dependency rather than answering with a bare ok", async ({ request }, testInfo) => {
    // This check read `postgresql: unavailable` on three separate runs, and
    // each time a manual curl a minute later read `ok`. That is a database
    // waking up, not a database that is down — but the two must not be
    // conflated, because telling them apart is the only reason this assertion
    // exists. So a still-waking dependency is retried within a bounded budget
    // and, if it comes up, recorded as a wake rather than silently passed; a
    // dependency that never comes up still fails.
    const attempts = [0, 5_000, 10_000, 20_000];
    let dependencies: Record<string, string> = {};
    let status = 0;
    let wokeAfterAttempts = 0;

    for (const [index, delay] of attempts.entries()) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const response = await request.get(`${apiBaseUrl}/health/ready`, { timeout: 45_000 });
      status = response.status();
      dependencies = (await response.json())?.data?.dependencies ?? {};
      if (dependencies.postgresql === "ok") {
        wokeAfterAttempts = index;
        break;
      }
    }

    expect(Object.keys(dependencies).length, "readiness must enumerate what it checked").toBeGreaterThan(0);
    expect(
      dependencies.postgresql,
      `postgresql never became available: ${JSON.stringify(dependencies)}`,
    ).toBe("ok");
    expect(status).toBe(200);

    if (wokeAfterAttempts > 0) {
      // Visible in the report rather than invisible in a pass: a deployment
      // that needs 20s of waking is healthy, but it is not the same evidence
      // as one that answers immediately.
      await testInfo.attach("readiness-cold-start", {
        body: `postgresql reported ok only after ${wokeAfterAttempts} retr${wokeAfterAttempts === 1 ? "y" : "ies"}; the instance was waking.`,
        contentType: "text/plain",
      });
      testInfo.annotations.push({ type: "cold-start", description: `${wokeAfterAttempts} retries` });
    }
  });

  test("CORS admits the deployed frontend origin with credentials", async ({ request }) => {
    const origin = new URL(userWebUrl).origin;
    const response = await request.fetch(`${apiBaseUrl}/auth/login`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
      timeout: 60_000,
    });
    const headers = response.headers();
    // Exact echo, never "*": the API sets allow_credentials.
    expect(headers["access-control-allow-origin"]).toBe(origin);
    expect(headers["access-control-allow-credentials"]).toBe("true");
  });

  test("an unauthenticated member endpoint refuses rather than leaking", async ({ request }) => {
    const response = await request.get(`${apiBaseUrl}/me`, {
      failOnStatusCode: false,
      timeout: 60_000,
    });
    expect([401, 403, 404]).toContain(response.status());
  });
});

/**
 * Transport-level failures, which mean the runner could not reach the host at
 * all. These are not deployment defects and must not be reported as if they
 * were: the first real run of this suite failed six tests with
 * ERR_CONNECTION_CLOSED while the API tests against a different host passed in
 * the same run, which is a local network or proxy symptom, not a broken site.
 */
const UNREACHABLE = /net::(ERR_CONNECTION_|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ERR_PROXY|ERR_TUNNEL|ERR_SSL|ERR_CERT)/;

class EnvironmentUnreachable extends Error {}

/**
 * Navigate, tolerating a cold start but not a broken page.
 *
 * A suspended free-tier instance drops the first connection while it wakes.
 * Failing on that would make this suite noisy enough to be ignored, which is
 * worse than not having it — so the navigation is retried within a bounded
 * budget, and only a persistent failure counts.
 */
async function assertRenders(page: Page, url: string) {
  const delaysMs = [0, 5_000, 15_000];
  let lastError: unknown;

  for (const delay of delaysMs) {
    if (delay) await page.waitForTimeout(delay);
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      expect(response?.status(), `${url} did not return a page`).toBeLessThan(400);
      await expect(page.locator("body")).not.toContainText("Internal Server Error");
      await expect(page.locator("body")).not.toContainText("Application error");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only retry what a cold start actually looks like. A page that loaded
      // and then failed an assertion is a real finding and must not be
      // retried into a pass.
      if (!UNREACHABLE.test(message)) throw error;
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message.split("\n")[0] : String(lastError);
  throw new EnvironmentUnreachable(
    `Could not reach ${url} after ${delaysMs.length} attempts: ${detail}\n` +
      "This is a reachability failure, not evidence that the deployment is broken. " +
      "Check it from the same machine with curl, and if this runner needs a proxy, " +
      "set E2E_PROXY_SERVER — Playwright does not pick up HTTPS_PROXY for browser " +
      "launches on its own.",
  );
}

test.describe("deployed frontends", () => {
  test("the member app boots without a chunk the deploy has already replaced", async ({ page }) => {
    const moduleFailures: string[] = [];
    const missingAssets: string[] = [];
    page.on("pageerror", (error) => {
      if (/dynamically imported module|Importing a module script failed/i.test(error.message)) {
        moduleFailures.push(error.message);
      }
    });
    page.on("response", (response) => {
      const url = response.url();
      // A SPA rewrite can answer a missing chunk with 200 text/html, which the
      // browser then refuses to execute. Status alone would not catch it.
      if (/\/assets\/.+\.(js|css)$/.test(url)) {
        const type = response.headers()["content-type"] ?? "";
        if (response.status() >= 400 || type.includes("text/html")) {
          missingAssets.push(`${response.status()} ${type} ${url}`);
        }
      }
    });

    await assertRenders(page, userWebUrl);
    await page.waitForLoadState("networkidle");
    expect(missingAssets, "an asset resolved to the SPA shell instead of the file").toEqual([]);
    expect(moduleFailures, "a stale client cannot load this deployment's chunks").toEqual([]);
    // `main, #app` matched both #app and #main-content and tripped strict mode.
    // The comma locator was never exercised until a page actually loaded, so
    // the bug hid behind connection failures. #app is the Vue mount point and
    // is unambiguous; the text assertion is what proves it mounted rather than
    // rendering an empty shell.
    await expect(page.locator("#app")).toBeVisible();
    expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(20);
  });

  test("the admin app serves its own entry and reaches the login route", async ({ page }) => {
    const missingAssets: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (/\/admin\/assets\/.+\.(js|css)$/.test(url)) {
        const type = response.headers()["content-type"] ?? "";
        if (response.status() >= 400 || type.includes("text/html")) {
          missingAssets.push(`${response.status()} ${type} ${url}`);
        }
      }
    });
    await assertRenders(page, `${adminWebUrl.replace(/\/+$/, "")}/login`);
    await page.waitForLoadState("networkidle");
    expect(missingAssets, "a missing admin chunk was masked by the SPA rewrite").toEqual([]);
    // Same strict-mode trap as above: scoped to one element on purpose.
    await expect(page.locator("#app")).toBeVisible();
    expect(await page.locator("form").count(), "the login route rendered no form").toBeGreaterThan(0);
  });

  test("a member-only route redirects instead of rendering", async ({ page }) => {
    await assertRenders(page, `${userWebUrl.replace(/\/+$/, "")}/zh-CN/account/dashboard`);
    await page.waitForLoadState("networkidle");
    // Not asserting a specific destination: what matters is that member data
    // is not rendered to an anonymous visitor.
    await expect(page.locator("body")).not.toContainText("我的任务");
  });
});
