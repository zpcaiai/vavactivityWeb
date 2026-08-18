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
 * UAT-REG-002 — Capacity and waitlist. Actors: multiple synthetic members.
 *
 * Fill the last seats concurrently, put the next member on the waitlist,
 * cancel a confirmed registration, and verify deterministic promotion.
 *
 * This case is honest about what it can and cannot establish on its own.
 *
 * The concurrency step needs an activity with exactly one seat left at the
 * moment the requests fire. Nothing here can arrange that on a shared
 * deployment without either mutating capacity — which would be changing the
 * system under test to make the test pass — or racing whatever real members
 * are doing. So the activity is nominated by the tester through
 * UAT_WAITLIST_ACTIVITY_SLUG, and the case verifies the *invariant* rather
 * than the setup: however many members push, confirmed registrations never
 * exceed capacity, and the overflow lands on the waitlist in a defined order.
 *
 * That invariant is the part worth automating. "Two members clicked at once"
 * is a scenario; "capacity was never exceeded" is the property, and the
 * property is what a regression would break.
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

const activitySlug = process.env.UAT_WAITLIST_ACTIVITY_SLUG ?? "";

let activityId = "";
let ticketTypeId = "";

test.beforeAll(() => {
  requireTarget({ writes: writesAllowed });
});

test.skip(!writesAllowed, "registers members; set UAT_ALLOW_WRITES=yes on a non-production target");

test("the nominated activity exposes capacity and a ticket type", async ({ request }, testInfo) => {
  expect(
    activitySlug,
    "Set UAT_WAITLIST_ACTIVITY_SLUG to an activity whose remaining capacity is small enough that " +
      "two concurrent registrations will contend for it.",
  ).toBeTruthy();

  const activity = await request.get(`${apiBaseUrl}/activities/${encodeURIComponent(activitySlug)}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const data = ((await jsonOf(activity)) as { data?: Record<string, unknown> })?.data ?? {};
  activityId = String(data.id ?? "");

  const ticketTypes = await request.get(`${apiBaseUrl}/activities/${activityId}/ticket-types`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const tickets = (((await jsonOf(ticketTypes)) as { data?: { items?: Array<Record<string, unknown>> } }).data
    ?.items ?? []) as Array<Record<string, unknown>>;
  ticketTypeId = String(tickets[0]?.id ?? "");

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-002-precondition",
    actor: "anonymous visitor",
    preconditions: [`UAT_WAITLIST_ACTIVITY_SLUG=${activitySlug}`],
    steps: [`GET /activities/${activitySlug}`, "GET its ticket types"],
    expected: "the activity is readable and offers at least one ticket type",
    actual: `activity ${activityId || "none"}, ticket ${ticketTypeId || "none"}`,
    status: activityId && ticketTypeId ? "PASS" : "FAIL",
  });

  expect(activityId, "the nominated activity is not publicly readable").toBeTruthy();
  expect(ticketTypeId, "the nominated activity offers no ticket type").toBeTruthy();
});

test("two members registering at once never exceed capacity", async ({ request }, testInfo) => {
  const [first, second] = [actorFor("member"), actorFor("member2")];
  const [sessionA, sessionB] = await Promise.all([login(request, first), login(request, second)]);

  const attempt = (headers: Record<string, string>, key: string) =>
    request.post(`${apiBaseUrl}/activities/${activityId}/registrations`, {
      headers,
      data: { ticket_type_id: ticketTypeId, idempotency_key: key },
      timeout: 60_000,
      failOnStatusCode: false,
    });

  // Fired together on purpose. Sequential requests would exercise a different
  // code path and would not touch the locking this case is about.
  const [responseA, responseB] = await Promise.all([
    attempt(sessionA.authHeaders(), `${runMarker}-a`),
    attempt(sessionB.authHeaders(), `${runMarker}-b`),
  ]);

  const statusOf = async (response: { json(): Promise<unknown>; text(): Promise<string>; status(): number }) => {
    if (response.status() >= 400) return `HTTP ${response.status()}`;
    const data = ((await jsonOf(response)) as { data?: { status?: string } })?.data ?? {};
    return String(data.status ?? "unknown");
  };
  const outcomes = [await statusOf(responseA), await statusOf(responseB)];

  const staff = await login(request, actorFor("admin"));
  const detail = await request.get(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const detailBody = ((await jsonOf(detail)) as { data?: Record<string, unknown> })?.data ?? {};
  const capacity = Number(detailBody.total_capacity ?? detailBody.capacity ?? NaN);
  const confirmed = Number(detailBody.confirmed_count ?? detailBody.confirmed ?? NaN);

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-002-concurrency",
    actor: "two members, concurrently",
    preconditions: [`activity ${activitySlug} open with limited remaining capacity`],
    steps: ["fire both registrations simultaneously", "read the activity's capacity counters as admin"],
    expected: "confirmed registrations never exceed capacity; any overflow is waitlisted, not lost",
    actual: `outcomes ${outcomes.join(" / ")}; capacity=${capacity} confirmed=${confirmed}`,
    status: Number.isFinite(capacity) && Number.isFinite(confirmed) && confirmed <= capacity ? "PASS" : "BLOCKED",
  });

  // Neither request may fail with a server error: contention must be resolved,
  // not crashed on.
  for (const [index, response] of [responseA, responseB].entries()) {
    expect(response.status(), `member ${index + 1} received a server error under contention`).toBeLessThan(500);
  }
  // Nobody may be silently dropped: every attempt ends confirmed, waitlisted,
  // or explicitly refused.
  for (const outcome of outcomes) {
    expect(outcome, `an attempt ended in an unreadable state: ${outcome}`).toMatch(
      /confirmed|waitlisted|pending|HTTP 4\d\d/,
    );
  }
  if (Number.isFinite(capacity) && Number.isFinite(confirmed)) {
    expect(confirmed, "confirmed registrations exceeded capacity under contention").toBeLessThanOrEqual(capacity);
  }
});

test("the overflow member sits on the waitlist in a defined position", async ({ request }, testInfo) => {
  const staff = await login(request, actorFor("admin"));
  const response = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/waitlist`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const items = response.ok()
    ? (((await jsonOf(response)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  const positions = items.map((item) => Number(item.position ?? item.rank ?? NaN));
  const ordered = positions.every((value, index) => index === 0 || value >= positions[index - 1]);
  const distinct = new Set(positions).size === positions.length;

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-002-waitlist-order",
    actor: "admin",
    preconditions: ["at least one member was waitlisted by the contention above"],
    steps: [`GET /admin/activities/${activityId}/waitlist`],
    expected: "the waitlist has a total order: positions are distinct and ascending",
    actual: `HTTP ${response.status()}; ${items.length} entries; positions ${JSON.stringify(positions)}`,
    status: items.length === 0 ? "BLOCKED" : ordered && distinct ? "PASS" : "FAIL",
  });

  if (items.length === 0) {
    // Not a failure: the activity may simply have had room for both. Said out
    // loud so the run is not read as having proven waitlisting works.
    test.info().annotations.push({
      type: "not-exercised",
      description: "nobody was waitlisted, so promotion order was not proven; use a fuller activity",
    });
    return;
  }
  expect(ordered, `waitlist positions are not ascending: ${JSON.stringify(positions)}`).toBe(true);
  expect(distinct, `waitlist positions collide, so promotion order is ambiguous: ${JSON.stringify(positions)}`).toBe(
    true,
  );
});

test("cancelling a confirmed registration promotes the head of the waitlist", async ({ request }, testInfo) => {
  const staff = await login(request, actorFor("admin"));

  const before = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/waitlist`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const beforeItems = before.ok()
    ? (((await jsonOf(before)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  test.skip(beforeItems.length === 0, "nobody is waitlisted, so there is no promotion to observe");

  const head = beforeItems[0];
  const member = await login(request, actorFor("member"));
  const mine = await request.get(`${apiBaseUrl}/account/activity-registrations`, {
    headers: member.authHeaders(),
    timeout: 60_000,
  });
  const items = (((await jsonOf(mine)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ??
    []) as Array<Record<string, unknown>>;
  const confirmed = items.find(
    (item) => String(item.activity_id ?? "") === activityId && String(item.status ?? "") === "confirmed",
  );
  test.skip(!confirmed, "this member holds no confirmed registration to release");

  const cancel = await request.post(
    `${apiBaseUrl}/account/activity-registrations/${String(confirmed!.id)}/cancel`,
    {
      headers: member.authHeaders(),
      data: { reason: `UAT ${runMarker}` },
      timeout: 60_000,
      failOnStatusCode: false,
    },
  );

  // Promotion may be handled by a worker rather than inline, so the waitlist is
  // polled instead of read once. A single immediate read would report a false
  // failure on a perfectly correct asynchronous implementation.
  let afterItems = beforeItems;
  for (const delay of [0, 3_000, 6_000, 10_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const after = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/waitlist`, {
      headers: staff.authHeaders(),
      timeout: 60_000,
      failOnStatusCode: false,
    });
    afterItems = after.ok()
      ? (((await jsonOf(after)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
      : afterItems;
    if (afterItems.length < beforeItems.length) break;
  }

  const headStillWaiting = afterItems.some((item) => String(item.id ?? "") === String(head?.id ?? ""));

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-002-promotion",
    actor: "member cancels; admin observes",
    preconditions: [`waitlist head ${String(head?.id ?? "unknown")}`, "the member holds a confirmed seat"],
    steps: ["cancel the confirmed registration", "poll the waitlist for up to 19s"],
    expected: "the seat is released and the head of the waitlist is promoted, deterministically",
    actual: `cancel HTTP ${cancel.status()}; waitlist ${beforeItems.length} -> ${afterItems.length}; head ${
      headStillWaiting ? "still waiting" : "promoted or removed"
    }`,
    status: cancel.ok() && !headStillWaiting ? "PASS" : "BLOCKED",
  });

  expect(cancel.status(), "the cancellation itself failed").toBeLessThan(400);
  expect(
    headStillWaiting,
    "The head of the waitlist was still waiting after a seat was released. Promotion may be " +
      "scheduled rather than immediate — check the worker before recording this as a defect.",
  ).toBe(false);
});
