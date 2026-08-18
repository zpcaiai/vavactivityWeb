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

test.describe("deployed API", () => {
  test("liveness answers and identifies the application", async ({ request }) => {
    const response = await request.get(`${apiBaseUrl}/health/live`, { timeout: 120_000 });
    expect(response.status(), "a suspended instance answers with the platform's error page").toBe(200);
    const body = await response.json();
    expect(body?.data?.status).toBe("ok");
    // The application, not a proxy, produced this.
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("readiness names each dependency rather than answering with a bare ok", async ({ request }) => {
    const response = await request.get(`${apiBaseUrl}/health/ready`, { timeout: 120_000 });
    const body = await response.json();
    const dependencies = body?.data?.dependencies ?? {};
    expect(Object.keys(dependencies).length, "readiness must enumerate what it checked").toBeGreaterThan(0);
    // Asserted explicitly because this exact check has read "unavailable" in
    // production while liveness was still green.
    expect(dependencies.postgresql, JSON.stringify(dependencies)).toBe("ok");
    expect(response.status()).toBe(200);
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

async function assertRenders(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  expect(response?.status(), `${url} did not return a page`).toBeLessThan(400);
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
  await expect(page.locator("body")).not.toContainText("Application error");
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
    await expect(page.locator("main, #app")).toBeVisible();
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
    await expect(page.locator("form, main")).toBeVisible();
  });

  test("a member-only route redirects instead of rendering", async ({ page }) => {
    await assertRenders(page, `${userWebUrl.replace(/\/+$/, "")}/zh-CN/account/dashboard`);
    await page.waitForLoadState("networkidle");
    // Not asserting a specific destination: what matters is that member data
    // is not rendered to an anonymous visitor.
    await expect(page.locator("body")).not.toContainText("我的任务");
  });
});
