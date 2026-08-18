import { expect, test, type Page } from "@playwright/test";

import { apiBaseUrl, jsonOf, recordEvidence, requireTarget, userWebUrl } from "./uat-context";

/**
 * UAT-CORE-001 — Public access. Actor: anonymous visitor.
 *
 * Read-only, so it needs no credentials and no write opt-in, and it can run
 * against production safely.
 *
 * The last item — "confirm draft/private event is inaccessible" — is the one
 * that matters, and it is asserted at the API rather than by looking at the
 * page. A page that renders nothing proves the UI hid it; only the API can
 * show the data was never served.
 */

test.describe.configure({ timeout: 240_000 });

test.beforeAll(() => requireTarget({ writes: false }));

async function open(page: Page, path: string) {
  const response = await page.goto(`${userWebUrl}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  expect(response?.status(), `${path} did not return a page`).toBeLessThan(400);
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
  return response;
}

test("an anonymous visitor can open the homepage", async ({ page }, testInfo) => {
  await open(page, "/");
  await expect(page.locator("#app")).toBeVisible();
  const text = (await page.locator("body").innerText()).trim();

  await recordEvidence(testInfo, {
    caseId: "UAT-CORE-001-homepage",
    actor: "anonymous visitor",
    preconditions: ["deployment reachable"],
    steps: ["open the user web root"],
    expected: "the homepage renders content without an error page",
    actual: `rendered ${text.length} characters of body text`,
    status: text.length > 20 ? "PASS" : "FAIL",
  });
  expect(text.length, "the homepage rendered an empty shell").toBeGreaterThan(20);
});

test("the public event list is served and every entry is published", async ({ page, request }, testInfo) => {
  // The API is the authority here. The list page could be filtering client
  // side, which would look identical and prove nothing about what was served.
  const response = await request.get(`${apiBaseUrl}/activities`, { timeout: 60_000, failOnStatusCode: false });
  expect(response.status(), "the public activity list is not served").toBe(200);
  const body = await jsonOf(response);
  const items = ((body as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? []) as Array<
    Record<string, unknown>
  >;

  const unpublished = items.filter((item) => {
    const status = String(item.status ?? "");
    return status === "draft" || status === "in_review" || status === "archived";
  });

  await open(page, "/zh-CN/activities");
  await expect(page.locator("#app")).toBeVisible();

  await recordEvidence(testInfo, {
    caseId: "UAT-CORE-001-event-list",
    actor: "anonymous visitor",
    preconditions: ["at least one published activity exists, or the list is legitimately empty"],
    steps: ["GET /activities as an anonymous caller", "open the activity list page"],
    expected: "the list is served and contains no draft, in-review or archived activity",
    actual: `${items.length} activities served; ${unpublished.length} were not public`,
    status: unpublished.length === 0 ? "PASS" : "FAIL",
  });

  expect(
    unpublished.map((item) => `${item.slug ?? item.id}:${item.status}`),
    "the public list served activities that are not published",
  ).toEqual([]);
});

test("a published event detail is reachable by slug", async ({ page, request }, testInfo) => {
  const list = await request.get(`${apiBaseUrl}/activities`, { timeout: 60_000, failOnStatusCode: false });
  const items = (((await jsonOf(list)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ??
    []) as Array<Record<string, unknown>>;
  const first = items[0];

  test.skip(!first, "no published activity exists on this deployment to open");

  const slug = String(first!.slug ?? "");
  const detail = await request.get(`${apiBaseUrl}/activities/${encodeURIComponent(slug)}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  expect(detail.status(), `activity detail for ${slug} was not served`).toBe(200);

  await open(page, `/zh-CN/activities/${encodeURIComponent(slug)}`);
  await expect(page.locator("#app")).toBeVisible();

  await recordEvidence(testInfo, {
    caseId: "UAT-CORE-001-event-detail",
    actor: "anonymous visitor",
    preconditions: [`published activity ${slug} exists`],
    steps: [`GET /activities/${slug}`, "open the detail page"],
    expected: "the detail is served and the page renders",
    actual: `detail HTTP ${detail.status()} for slug ${slug}`,
    status: detail.ok() ? "PASS" : "FAIL",
  });
});

test("a draft or unknown event is not served to an anonymous caller", async ({ request }, testInfo) => {
  // Two probes: a slug that cannot exist, and — if the deployment exposes one
  // — a real non-public activity. Only the API can answer this; a blank page
  // would prove the UI hid it, not that the data stayed server-side.
  const invented = `${"uat-nonexistent"}-${Math.abs(Date.now() % 100000)}`;
  const missing = await request.get(`${apiBaseUrl}/activities/${invented}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const results = [`unknown slug -> HTTP ${missing.status()}`];
  expect([404, 403], `an unknown activity returned ${missing.status()}`).toContain(missing.status());

  const draftSlug = process.env.UAT_DRAFT_ACTIVITY_SLUG;
  let draftStatus: number | null = null;
  if (draftSlug) {
    const draft = await request.get(`${apiBaseUrl}/activities/${encodeURIComponent(draftSlug)}`, {
      timeout: 60_000,
      failOnStatusCode: false,
    });
    draftStatus = draft.status();
    results.push(`draft slug ${draftSlug} -> HTTP ${draftStatus}`);
    expect([404, 403], `a draft activity leaked with HTTP ${draftStatus}`).toContain(draftStatus);
  }

  await recordEvidence(testInfo, {
    caseId: "UAT-CORE-001-draft-inaccessible",
    actor: "anonymous visitor",
    preconditions: [
      draftSlug
        ? `UAT_DRAFT_ACTIVITY_SLUG=${draftSlug} names a genuinely non-public activity`
        : "UAT_DRAFT_ACTIVITY_SLUG not supplied; only the unknown-slug probe ran",
    ],
    steps: results,
    expected: "non-public activities are refused, not rendered",
    actual: results.join("; "),
    // Honest about coverage: without a real draft slug this is the weaker of
    // the two probes, and the evidence should say so rather than imply the
    // full check ran.
    status: draftSlug ? "PASS" : "BLOCKED",
  });

  expect(
    draftSlug,
    "Set UAT_DRAFT_ACTIVITY_SLUG to a real non-public activity. Without it this case only " +
      "proves an unknown slug 404s, which any deployment does.",
  ).toBeTruthy();
});
