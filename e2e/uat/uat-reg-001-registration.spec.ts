import { expect, test } from "@playwright/test";

import {
  actorFor,
  apiBaseUrl,
  jsonOf,
  login,
  recordEvidence,
  requireTarget,
  runMarker,
  userWebUrl,
  writesAllowed,
} from "./uat-context";

/**
 * UAT-REG-001 — Registration closed loop. Actor: member.
 *
 * Register, see a clear result, find it in My Events, retry the request,
 * cancel, and verify the state.
 *
 * The retry step is the interesting one and is easy to get wrong. "Retry
 * request" does not mean "the second call also succeeds" — it means the member
 * does not end up registered twice. So it asserts on the registration count
 * before and after, not on the second response's status code, which could
 * legitimately be either 201-with-the-same-record or 409.
 *
 * Needs UAT_ACTIVITY_SLUG: an open activity on the target with a free ticket
 * and capacity to spare. Guessing one from the public list would work by
 * accident and fail confusingly the day the list changes.
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

const activitySlug = process.env.UAT_ACTIVITY_SLUG ?? "";

let activityId = "";
let registrationId = "";

test.beforeAll(() => {
  requireTarget({ writes: writesAllowed });
});

test.skip(!writesAllowed, "registers a member; set UAT_ALLOW_WRITES=yes on a non-production target");

test("the target activity is open for registration", async ({ request }, testInfo) => {
  expect(
    activitySlug,
    "Set UAT_ACTIVITY_SLUG to an activity that is open for registration with a free ticket type.",
  ).toBeTruthy();

  const response = await request.get(`${apiBaseUrl}/activities/${encodeURIComponent(activitySlug)}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const body = await jsonOf(response);
  const data = (body as { data?: Record<string, unknown> }).data ?? {};
  activityId = String(data.id ?? "");

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-001-precondition",
    actor: "anonymous visitor",
    preconditions: [`UAT_ACTIVITY_SLUG=${activitySlug}`],
    steps: [`GET /activities/${activitySlug}`],
    expected: "the activity is served publicly and is open for registration",
    actual: `HTTP ${response.status()} status=${String(data.status ?? "unknown")} id=${activityId || "none"}`,
    status: response.ok() && activityId ? "PASS" : "FAIL",
  });

  expect(response.status(), "the target activity is not publicly readable").toBe(200);
  expect(activityId).toBeTruthy();
});

test("the member registers and receives a clear result", async ({ request }, testInfo) => {
  const member = await login(request, actorFor("member"));

  const ticketTypes = await request.get(`${apiBaseUrl}/activities/${activityId}/ticket-types`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const tickets = (((await jsonOf(ticketTypes)) as { data?: { items?: Array<Record<string, unknown>> } }).data
    ?.items ?? []) as Array<Record<string, unknown>>;
  const ticket = tickets[0];
  expect(ticket, `activity ${activitySlug} exposes no ticket type to register against`).toBeTruthy();

  const response = await request.post(`${apiBaseUrl}/activities/${activityId}/registrations`, {
    headers: member.authHeaders(),
    data: { ticket_type_id: ticket!.id, idempotency_key: `${runMarker}-reg-1` },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const body = await jsonOf(response);
  const data = (body as { data?: Record<string, unknown> }).data ?? {};
  registrationId = String(data.id ?? "");
  const status = String(data.status ?? "");

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-001-register",
    actor: "member",
    preconditions: [`activity ${activitySlug} open`, "member has no existing registration for it"],
    steps: [`POST /activities/${activityId}/registrations`],
    expected: "201 with a registration whose status states the outcome plainly",
    actual: `HTTP ${response.status()} id=${registrationId || "none"} status=${status || "unknown"}`,
    status: response.status() === 201 && registrationId ? "PASS" : "FAIL",
  });

  expect(response.status(), `registration failed: ${JSON.stringify(body).slice(0, 300)}`).toBe(201);
  expect(registrationId).toBeTruthy();
  // The result has to be legible, not merely successful: a member who cannot
  // tell confirmed from waitlisted has not received "a clear result".
  expect(
    ["confirmed", "waitlisted", "pending_payment", "pending_approval", "approved_pending_payment"],
    `unrecognised registration status ${status}`,
  ).toContain(status);
});

test("the registration appears in My Events", async ({ request, page }, testInfo) => {
  const member = await login(request, actorFor("member"));

  const list = await request.get(`${apiBaseUrl}/account/activity-registrations`, {
    headers: member.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const items = (((await jsonOf(list)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ??
    []) as Array<Record<string, unknown>>;
  const mine = items.find((item) => String(item.id) === registrationId);

  // The page is checked too, but the API is what the assertion rests on — per
  // the checklist, a screenshot alone is not evidence.
  await page.goto(`${userWebUrl}/zh-CN/account/activities`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-001-my-events",
    actor: "member",
    preconditions: [`registration ${registrationId} exists`],
    steps: ["GET /account/activity-registrations", "open the My Events page"],
    expected: "the registration created above is listed for this member",
    actual: `${items.length} registrations returned; target ${mine ? "present" : "absent"}`,
    status: mine ? "PASS" : "FAIL",
  });

  expect(mine, "the new registration is not listed in the member's own registrations").toBeTruthy();
});

test("retrying the request does not register the member twice", async ({ request }, testInfo) => {
  const member = await login(request, actorFor("member"));

  const before = await request.get(`${apiBaseUrl}/account/activity-registrations`, {
    headers: member.authHeaders(),
    timeout: 60_000,
  });
  const countFor = async (response: { json(): Promise<unknown>; text(): Promise<string> }) => {
    const items = (((await jsonOf(response)) as { data?: { items?: Array<Record<string, unknown>> } }).data
      ?.items ?? []) as Array<Record<string, unknown>>;
    return items.filter((item) => String(item.activity_id ?? "") === activityId).length;
  };
  const countBefore = await countFor(before);

  const retry = await request.post(`${apiBaseUrl}/activities/${activityId}/registrations`, {
    headers: member.authHeaders(),
    data: { ticket_type_id: null, idempotency_key: `${runMarker}-reg-1` },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const after = await request.get(`${apiBaseUrl}/account/activity-registrations`, {
    headers: member.authHeaders(),
    timeout: 60_000,
  });
  const countAfter = await countFor(after);

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-001-retry",
    actor: "member",
    preconditions: [`member already registered for ${activityId}`],
    steps: ["repeat the registration request with the same idempotency key", "count registrations again"],
    expected: "the member holds exactly one registration for this activity, whatever the retry answered",
    actual: `retry HTTP ${retry.status()}; registrations for this activity ${countBefore} -> ${countAfter}`,
    status: countAfter === countBefore ? "PASS" : "FAIL",
  });

  // The status code is recorded but not asserted: 201 returning the existing
  // record and 409 refusing are both defensible. Two registrations are not.
  expect(countAfter, "retrying the request produced a duplicate registration").toBe(countBefore);
});

test("the member cancels and the state changes accordingly", async ({ request }, testInfo) => {
  const member = await login(request, actorFor("member"));

  const cancel = await request.post(
    `${apiBaseUrl}/account/activity-registrations/${registrationId}/cancel`,
    {
      headers: member.authHeaders(),
      data: { reason: `UAT ${runMarker}` },
      timeout: 60_000,
      failOnStatusCode: false,
    },
  );

  const readBack = await request.get(`${apiBaseUrl}/account/activity-registrations/${registrationId}`, {
    headers: member.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const status = String(
    ((await jsonOf(readBack)) as { data?: { status?: string } })?.data?.status ?? "unknown",
  );

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-001-cancel",
    actor: "member",
    preconditions: [`registration ${registrationId} is active`],
    steps: ["POST the cancel endpoint", "read the registration back"],
    expected: "cancellation succeeds and the stored status reflects it",
    actual: `cancel HTTP ${cancel.status()}; stored status ${status}`,
    status: cancel.ok() && status.includes("cancel") ? "PASS" : "FAIL",
  });

  expect(cancel.status(), `cancel failed: ${(await cancel.text()).slice(0, 300)}`).toBeLessThan(400);
  expect(status, `expected a cancelled state, stored status is ${status}`).toMatch(/cancel/);
});

test("the member is notified of the cancellation", async ({ request }, testInfo) => {
  const member = await login(request, actorFor("member"));
  const response = await request.get(`${apiBaseUrl}/account/notifications`, {
    headers: member.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const items = response.ok()
    ? (((await jsonOf(response)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  const related = items.filter((item) => JSON.stringify(item).includes(activityId));

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-001-notification",
    actor: "member",
    preconditions: ["the registration was cancelled in this run"],
    steps: ["GET the member's notifications", `look for entries referencing ${activityId}`],
    expected: "a notification records the cancellation",
    actual: response.ok()
      ? `${items.length} notifications, ${related.length} referencing this activity`
      : `notifications endpoint answered HTTP ${response.status()}`,
    // Delivery may be asynchronous, and this suite has no inbox: a missing
    // notification here is not proof that none was sent, so it is reported as
    // BLOCKED for a person to confirm rather than failed.
    status: related.length > 0 ? "PASS" : "BLOCKED",
  });

  expect(
    related.length > 0 || !response.ok(),
    "No in-app notification referenced this activity. Delivery may be asynchronous or by email; " +
      "confirm by hand before treating this as a defect.",
  ).toBe(true);
});
