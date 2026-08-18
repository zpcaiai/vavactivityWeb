import { expect, test } from "@playwright/test";

import {
  actorFor,
  apiBaseUrl,
  jsonOf,
  login,
  recordEvidence,
  requireTarget,
  runMarker,
  writesAllowed,
} from "./uat-context";

/**
 * UAT-EVENT-ADMIN-001 — Admin publishing. Actor: admin.
 *
 * This case creates an activity on the target, so it is gated behind
 * UAT_ALLOW_WRITES and refuses production. Everything it creates carries the
 * run marker in its title and slug, and the last test cancels it, so a
 * completed run leaves nothing that looks like a real event.
 *
 * The whole case runs in one serial file because the steps are one story: a
 * draft that is never created cannot be validated, edited or published, and
 * reporting four independent failures for one missing precondition is noise.
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

let activityId = "";
let slug = "";

test.beforeAll(() => {
  requireTarget({ writes: writesAllowed });
});

test.skip(!writesAllowed, "creates an activity; set UAT_ALLOW_WRITES=yes on a non-production target");

test("required fields are validated before a draft is accepted", async ({ request }, testInfo) => {
  const admin = await login(request, actorFor("admin"));

  const response = await request.post(`${apiBaseUrl}/admin/activities`, {
    headers: admin.authHeaders(),
    // Deliberately incomplete. Asserting the rejection first means a later
    // successful create actually says something: without this, a permissive
    // endpoint that accepts anything would still look like a pass.
    data: { title: "" },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-validation",
    actor: "admin",
    preconditions: ["admin session"],
    steps: ["POST /admin/activities with an empty payload"],
    expected: "422 or 400; the draft is not created",
    actual: `HTTP ${response.status()}`,
    status: [400, 422].includes(response.status()) ? "PASS" : "FAIL",
  });

  expect([400, 422], `an incomplete activity was accepted with HTTP ${response.status()}`).toContain(
    response.status(),
  );
});

test("an admin creates a draft", async ({ request }, testInfo) => {
  const admin = await login(request, actorFor("admin"));
  const title = `${runMarker} UAT 活动`;
  slug = `${runMarker.toLowerCase()}-uat-activity`;

  const response = await request.post(`${apiBaseUrl}/admin/activities`, {
    headers: admin.authHeaders(),
    data: {
      title,
      slug,
      summary: "Created by the automated UAT suite. Safe to delete.",
      locale: "zh-CN",
    },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const body = await jsonOf(response);
  activityId = String((body as { data?: { id?: string } })?.data?.id ?? "");

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-create",
    actor: "admin",
    preconditions: ["admin session", "writes enabled on a non-production target"],
    steps: [`POST /admin/activities with title ${title}`],
    expected: "201 with an identifier, and the activity starts as a draft",
    actual: `HTTP ${response.status()} id=${activityId || "none"} status=${
      (body as { data?: { status?: string } })?.data?.status ?? "unknown"
    }`,
    status: response.status() === 201 && activityId ? "PASS" : "FAIL",
  });

  expect(response.status(), `draft creation failed: ${JSON.stringify(body).slice(0, 300)}`).toBe(201);
  expect(activityId, "the API returned no activity id").toBeTruthy();
  expect((body as { data?: { status?: string } })?.data?.status, "a new activity should start as a draft").toBe(
    "draft",
  );
});

test("the draft is not visible on the public surface", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();

  // The same assertion UAT-CORE-001 makes in the abstract, made here against a
  // draft this run definitely created — which is the stronger form, because it
  // does not depend on the deployment happening to have one.
  const anonymous = await request.get(`${apiBaseUrl}/activities/${slug}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-draft-hidden",
    actor: "anonymous visitor",
    preconditions: [`draft ${slug} exists`],
    steps: [`GET /activities/${slug} with no credentials`],
    expected: "404 or 403 while the activity is a draft",
    actual: `HTTP ${anonymous.status()}`,
    status: [403, 404].includes(anonymous.status()) ? "PASS" : "FAIL",
  });

  expect([403, 404], `a draft activity was served publicly with HTTP ${anonymous.status()}`).toContain(
    anonymous.status(),
  );
});

test("the admin edits the draft and the change is read back", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await login(request, actorFor("admin"));
  const summary = `Edited by UAT at ${new Date().toISOString()}`;

  const patch = await request.patch(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers: admin.authHeaders(),
    data: { summary },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  // Read back rather than trusting the write's own response: an endpoint that
  // echoes its input without persisting would pass the weaker check.
  const readBack = await request.get(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers: admin.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const stored = String(
    ((await jsonOf(readBack)) as { data?: { summary?: string } })?.data?.summary ?? "",
  );

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-edit",
    actor: "admin",
    preconditions: [`draft ${activityId} exists`],
    steps: ["PATCH the summary", "GET the activity back"],
    expected: "the stored summary equals what was written",
    actual: `patch HTTP ${patch.status()}; stored summary ${stored === summary ? "matches" : "differs"}`,
    status: patch.ok() && stored === summary ? "PASS" : "FAIL",
  });

  expect(patch.status()).toBeLessThan(400);
  expect(stored, "the edit was not persisted").toBe(summary);
});

test("the admin publishes it and it appears on the public surface", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await login(request, actorFor("admin"));

  const transition = await request.post(`${apiBaseUrl}/admin/activities/${activityId}/transition`, {
    headers: admin.authHeaders(),
    data: { status: "published" },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const anonymous = await request.get(`${apiBaseUrl}/activities/${slug}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-publish",
    actor: "admin, then anonymous visitor",
    preconditions: [`draft ${activityId} exists and was edited`],
    steps: ["POST the published transition", `GET /activities/${slug} with no credentials`],
    expected: "the transition succeeds and the activity becomes publicly readable",
    actual: `transition HTTP ${transition.status()}; anonymous read HTTP ${anonymous.status()}`,
    status: transition.ok() && anonymous.ok() ? "PASS" : "FAIL",
  });

  expect(transition.status(), `publish failed: ${(await transition.text()).slice(0, 300)}`).toBeLessThan(400);
  expect(anonymous.status(), "a published activity is still not publicly readable").toBe(200);
});

test("the publication is recorded in the audit trail", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await login(request, actorFor("admin"));

  const audit = await request.get(`${apiBaseUrl}/admin/audit-events`, {
    headers: admin.authHeaders(),
    params: { limit: "50" },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const events = audit.ok()
    ? (((await jsonOf(audit)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  const related = events.filter((event) => JSON.stringify(event).includes(activityId));

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-audit",
    actor: "admin",
    preconditions: [`activity ${activityId} was created, edited and published in this run`],
    steps: ["GET the most recent audit events", `look for entries referencing ${activityId}`],
    expected: "the lifecycle of this activity appears in the audit trail",
    actual: audit.ok()
      ? `${events.length} recent events, ${related.length} referencing this activity`
      : `audit endpoint answered HTTP ${audit.status()}`,
    status: audit.ok() && related.length > 0 ? "PASS" : "BLOCKED",
  });

  // BLOCKED rather than FAIL when the endpoint is not reachable with this
  // admin's permissions: that is a scope question for the tester, not proof
  // that auditing is broken.
  expect(
    audit.ok(),
    `the audit endpoint answered HTTP ${audit.status()}. If this admin lacks admin.audit.read, ` +
      "verify the audit entry by hand and record it rather than treating this as a pass.",
  ).toBe(true);
  expect(related.length, "publishing an activity left no audit record").toBeGreaterThan(0);
});

test.afterAll(async ({ request }) => {
  // Cleanup is best-effort and deliberately loud when it fails: an event left
  // published on a shared environment is worse than a failed test.
  if (!activityId || !writesAllowed) return;
  try {
    const admin = await login(request, actorFor("admin"));
    const cancelled = await request.post(`${apiBaseUrl}/admin/activities/${activityId}/cancel`, {
      headers: admin.authHeaders(),
      data: { reason: `UAT cleanup for ${runMarker}` },
      timeout: 60_000,
      failOnStatusCode: false,
    });
    if (!cancelled.ok()) {
      console.error(
        `[UAT] could not cancel activity ${activityId} (${slug}); remove it by hand. ` +
          `HTTP ${cancelled.status()}`,
      );
    }
  } catch (error) {
    console.error(`[UAT] cleanup failed for activity ${activityId} (${slug}):`, error);
  }
});
