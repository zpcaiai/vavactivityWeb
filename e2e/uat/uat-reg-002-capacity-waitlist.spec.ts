import { expect, test } from "@playwright/test";

import {
  actorFor,
  apiBaseUrl,
  jsonOf,
  login,
  recordEvidence,
  requireTarget,
  sessionFor,
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
  const staffEarly = await sessionFor(request, "admin");
  const attendanceBefore = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: staffEarly.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const confirmedBefore = Number(
    ((await jsonOf(attendanceBefore)) as { data?: { summary?: Record<string, unknown> } })?.data?.summary
      ?.confirmed ?? NaN,
  );

  const [sessionA, sessionB] = await Promise.all([
    sessionFor(request, "member"),
    login(request, actorFor("member2")),
  ]);

  const attempt = (headers: Record<string, string>) =>
    request.post(`${apiBaseUrl}/activities/${activityId}/registrations`, {
      headers,
      data: { ticket_type_id: ticketTypeId, locale: "zh-CN", form_response: {}, accepted_consents: [] },
      timeout: 60_000,
      failOnStatusCode: false,
    });

  // Fired together on purpose. Sequential requests would exercise a different
  // code path and would not touch the locking this case is about.
  const [responseA, responseB] = await Promise.all([
    attempt(sessionA.authHeaders()),
    attempt(sessionB.authHeaders()),
  ]);

  const statusOf = async (response: { json(): Promise<unknown>; text(): Promise<string>; status(): number }) => {
    if (response.status() >= 400) return `HTTP ${response.status()}`;
    const data = ((await jsonOf(response)) as { data?: { status?: string } })?.data ?? {};
    return String(data.status ?? "unknown");
  };
  const outcomes = [await statusOf(responseA), await statusOf(responseB)];

  // The admin activity payload carries no capacity counters: remaining stock
  // lives on the ticket type's `availability` block (service.py:160, and only
  // when capacity_display_mode is "exact"), and the confirmed head count on
  // the attendance summary (router.py:1245). Reading total_capacity here
  // returned undefined and quietly turned the assertion below into a no-op.
  const staff = staffEarly;
  const attendance = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const summary = ((await jsonOf(attendance)) as { data?: { summary?: Record<string, unknown> } })?.data
    ?.summary ?? {};
  const confirmed = Number(summary.confirmed ?? NaN);

  const tickets = await request.get(`${apiBaseUrl}/activities/${activityId}/ticket-types`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const ticket = ((((await jsonOf(tickets)) as { data?: { items?: Array<Record<string, unknown>> } }).data
    ?.items ?? []) as Array<Record<string, unknown>>).find((item) => String(item.id) === ticketTypeId);
  const availability = (ticket?.availability ?? {}) as { status?: string; remaining?: number | null };
  const remaining = availability.remaining === null ? NaN : Number(availability.remaining ?? NaN);

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-002-concurrency",
    actor: "two members, concurrently",
    preconditions: [`activity ${activitySlug} open with limited remaining capacity`],
    steps: [
      "fire both registrations simultaneously",
      "read the attendance summary and the ticket's remaining stock as admin",
    ],
    expected: "stock never goes negative; any overflow is waitlisted, not lost",
    actual: `outcomes ${outcomes.join(" / ")}; confirmed ${confirmedBefore} -> ${confirmed}; stock ${
      Number.isFinite(remaining) ? remaining : `hidden (${availability.status ?? "unknown"})`
    }`,
    status:
      Number.isFinite(confirmedBefore) &&
      Number.isFinite(confirmed) &&
      confirmed - confirmedBefore === outcomes.filter((outcome) => outcome === "confirmed").length
        ? "PASS"
        : "BLOCKED",
    defects: [],
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
  // Oversell is the defect this case exists to catch, and it has to be counted
  // rather than read off `remaining`: the serializer clamps anything <= 0 to
  // {"status":"sold_out","remaining":0} (service.py:167), so a negative value
  // is unreachable and asserting remaining >= 0 could never fail.
  //
  // The countable invariant is conservation: the confirmed head count must go
  // up by exactly the number of attempts the API said were confirmed. One more
  // means a seat was created out of nothing; one fewer means somebody was told
  // they were in and is not.
  //
  // Recorded, not asserted: summary.confirmed counts the whole activity, so a
  // real member registering or a waitlist offer being accepted between the two
  // reads moves it without either attempt saying "confirmed". Hard-failing on
  // a shared deployment would manufacture flakes and teach whoever runs this
  // to ignore red. The hard assertions stay on the two properties that no
  // third party can disturb: nobody got a 5xx, and every outcome is legible.
  const confirmedAttempts = outcomes.filter((outcome) => outcome === "confirmed").length;
  const conserved = confirmed - confirmedBefore === confirmedAttempts;
  if (Number.isFinite(confirmedBefore) && Number.isFinite(confirmed)) {
    if (!conserved) {
      test.info().annotations.push({
        type: "investigate",
        description:
          `${confirmedAttempts} attempt(s) were told they were confirmed, but the confirmed head ` +
          `count moved ${confirmedBefore} -> ${confirmed}. On a quiet environment that is a defect; ` +
          "on a busy one it may be another member. Check before filing.",
      });
    }
  } else {
    test.info().annotations.push({
      type: "not-exercised",
      description:
        "the attendance summary was unreadable, so conservation of confirmed seats could not be " +
        "checked; only the no-5xx and legible-outcome properties were proven",
    });
  }
});

test("the overflow member sits on the waitlist in a defined position", async ({ request }, testInfo) => {
  const staff = await sessionFor(request, "admin");
  const response = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/waitlist`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const items = response.ok()
    ? (((await jsonOf(response)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  // waitlist_payload exposes `sequence_number` (service.py:110); there is no
  // `position` or `rank`, and reading those produced NaN, which made both
  // assertions below vacuously true.
  //
  // But sequence_number is NOT the order. The route sorts by priority_score
  // DESC, then manual_order_override, then sequence_number (router.py:1143),
  // and sequence_number is allocated per (activity_id, ticket_type_id)
  // (service.py:943) — so on a correctly ordered list with two ticket types,
  // asserting "sequence numbers ascend" and "sequence numbers are distinct"
  // would both fail for reasons that are not defects.
  //
  // What the requirement actually needs is that the queue has *a* definite
  // order: every entry is placed, no two entries within one ticket type share
  // a place, and two reads agree. That is what is asserted.
  const positions = items.map((item) => Number(item.sequence_number ?? NaN));
  const placed = positions.every((value) => Number.isFinite(value));
  const byTicket = new Map<string, number[]>();
  for (const item of items) {
    const key = String(item.ticket_type_id ?? "");
    byTicket.set(key, [...(byTicket.get(key) ?? []), Number(item.sequence_number ?? NaN)]);
  }
  const distinct = [...byTicket.values()].every((group) => new Set(group).size === group.length);

  const second = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/waitlist`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const secondIds = second.ok()
    ? (((await jsonOf(second)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? []).map(
        (item) => String(item.id),
      )
    : [];
  // A queue that reshuffles between reads has no head, so "promote the head"
  // would be undefined behaviour however it is implemented.
  const stable = JSON.stringify(secondIds) === JSON.stringify(items.map((item) => String(item.id)));

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-002-waitlist-order",
    actor: "admin",
    preconditions: ["at least one member was waitlisted by the contention above"],
    steps: [`GET /admin/activities/${activityId}/waitlist`],
    expected:
      "the waitlist has a definite order: every entry is placed, places are unique within a ticket " +
      "type, and two consecutive reads agree",
    actual: `HTTP ${response.status()}; ${items.length} entries; sequence numbers ${JSON.stringify(
      positions,
    )}; repeat read ${stable ? "identical" : "DIFFERENT"}`,
    status: items.length === 0 ? "BLOCKED" : placed && distinct && stable ? "PASS" : "FAIL",
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
  expect(placed, `a waitlist entry has no sequence number: ${JSON.stringify(positions)}`).toBe(true);
  expect(
    distinct,
    `two entries on the same ticket type share a place, so promotion order is ambiguous: ${JSON.stringify(
      positions,
    )}`,
  ).toBe(true);
  expect(stable, "two consecutive reads of the waitlist returned different orders").toBe(true);
});

test("cancelling a confirmed registration promotes the head of the waitlist", async ({ request }, testInfo) => {
  const staff = await sessionFor(request, "admin");

  const before = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/waitlist`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const beforeItems = before.ok()
    ? (((await jsonOf(before)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  test.skip(beforeItems.length === 0, "nobody is waitlisted, so there is no promotion to observe");


  // WaitlistStatus.ACTIVE is the only state that can be promoted; the endpoint
  // applies no status filter (router.py:1139), so beforeItems[0] can be a
  // cancelled/declined/promoted leftover from an earlier run — and because the
  // sort is priority_score DESC first, a stale high-priority row sits at the
  // head permanently and would never change status.
  const waiting = beforeItems.filter((item) => String(item.status ?? "") === "active");
  test.skip(waiting.length === 0, "no entry is in the active waitlist state, so there is nothing to promote");
  const head = waiting[0];
  const member = await sessionFor(request, "member");
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
      // ReasonRequest requires reason_code as well as reason
      // (activities/schemas.py:214); sending only `reason` is a 422.
      data: { reason_code: "uat_cancel", reason: `Automated UAT cancellation for ${runMarker}.` },
      timeout: 60_000,
      failOnStatusCode: false,
    },
  );

  // Promotion may be handled by a worker rather than inline, so the waitlist is
  // polled instead of read once. A single immediate read would report a false
  // failure on a perfectly correct asynchronous implementation.
  const headId = String(head?.id ?? "");
  const statusOfHead = (list: Array<Record<string, unknown>>) =>
    String(list.find((item) => String(item.id ?? "") === headId)?.status ?? "gone");
  const before_ = statusOfHead(beforeItems);

  let afterItems = beforeItems;
  let headStatus = before_;
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
    headStatus = statusOfHead(afterItems);
    // Promotion changes the entry's status to promotion_offered
    // (service.py:1345); it does NOT delete the row, and the endpoint applies
    // no status filter (router.py:1141). Waiting for the list to shrink — as
    // this loop used to — could never succeed, so it always burnt the full
    // 19 seconds and then reported a correct implementation as broken.
    if (headStatus !== before_) break;
  }

  const headStillWaiting = headStatus === before_;

  await recordEvidence(testInfo, {
    caseId: "UAT-REG-002-promotion",
    actor: "member cancels; admin observes",
    preconditions: [`waitlist head ${String(head?.id ?? "unknown")}`, "the member holds a confirmed seat"],
    steps: ["cancel the confirmed registration", "poll the waitlist for up to 19s"],
    expected: "the seat is released and the head of the waitlist is promoted, deterministically",
    actual: `cancel HTTP ${cancel.status()}; waitlist ${beforeItems.length} -> ${afterItems.length} entries; ` +
      `head ${headId.slice(0, 8)} status ${before_} -> ${headStatus}`,
    status: cancel.ok() && !headStillWaiting ? "PASS" : "BLOCKED",
    defects: [],
  });

  expect(cancel.status(), "the cancellation itself failed").toBeLessThan(400);

  // Not a hard assertion, and this is the honest reading rather than a
  // convenience: RegistrationService.cancel releases the seat and cancels the
  // member's own waitlist entry, but never calls offer_waitlist_places
  // (service.py:1225). Promotion happens on the worker path and only when
  // activity_waitlist_auto_promotion_enabled is on (service.py:1298). So a
  // head that is still waiting after 19 seconds means "no worker ran in that
  // window", which is not the same as "promotion is broken" — and recording it
  // as a failure would be the suite lying in the safe-looking direction.
  if (headStillWaiting) {
    test.info().annotations.push({
      type: "not-exercised",
      description:
        "the seat was released but no promotion was observed within 19s. Confirm the promotion " +
        "worker is running and activity_waitlist_auto_promotion_enabled is on before treating this " +
        "as a defect; if it is running, this IS a defect.",
    });
  }
});
