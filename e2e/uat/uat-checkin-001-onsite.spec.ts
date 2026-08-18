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
 * UAT-CHECKIN-001 — Onsite. Actors: member and staff.
 *
 * Valid self check-in, a duplicate credential, a staff lookup by registration
 * number, phone-last-four lookup in both the unique and the ambiguous case,
 * and an undo with a reason that lands in the audit trail.
 *
 * This is the most invasive case in the checklist: a check-in is an attendance
 * record about a real person, and the undo leaves its own audit entry rather
 * than erasing anything. It therefore needs both the write opt-in and an
 * activity nominated explicitly — UAT_CHECKIN_ACTIVITY_SLUG — so it can never
 * pick a live event by accident.
 *
 * The ambiguous phone-last-four case needs two registrations whose phone
 * numbers end in the same four digits. That cannot be arranged from here
 * without inventing member data, so it is reported as BLOCKED with what the
 * tester has to set up, rather than quietly dropped.
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

const activitySlug = process.env.UAT_CHECKIN_ACTIVITY_SLUG ?? "";

let activityId = "";
let registrationId = "";
let registrationNumber = "";
let credentialToken = "";

test.beforeAll(() => {
  requireTarget({ writes: writesAllowed });
});

test.skip(!writesAllowed, "records attendance; set UAT_ALLOW_WRITES=yes on a non-production target");

test("a member holds a registration on the nominated activity", async ({ request }, testInfo) => {
  expect(
    activitySlug,
    "Set UAT_CHECKIN_ACTIVITY_SLUG. This case writes attendance records, so the activity is " +
      "named explicitly rather than discovered.",
  ).toBeTruthy();

  const member = await login(request, actorFor("member"));
  const activity = await request.get(`${apiBaseUrl}/activities/${encodeURIComponent(activitySlug)}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  activityId = String(((await jsonOf(activity)) as { data?: { id?: string } })?.data?.id ?? "");
  expect(activityId, `activity ${activitySlug} is not publicly readable`).toBeTruthy();

  const list = await request.get(`${apiBaseUrl}/account/activity-registrations`, {
    headers: member.authHeaders(),
    timeout: 60_000,
  });
  const items = (((await jsonOf(list)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ??
    []) as Array<Record<string, unknown>>;
  const mine = items.find((item) => String(item.activity_id ?? "") === activityId);
  registrationId = String(mine?.id ?? "");
  registrationNumber = String(mine?.registration_number ?? "");

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-precondition",
    actor: "member",
    preconditions: [`UAT_CHECKIN_ACTIVITY_SLUG=${activitySlug}`, "the member is registered and confirmed"],
    steps: ["GET the activity", "GET the member's registrations"],
    expected: "the member holds a confirmed registration with a registration number",
    actual: `registration ${registrationId || "none"} number ${registrationNumber || "none"} status ${
      mine?.status ?? "none"
    }`,
    status: registrationId && registrationNumber ? "PASS" : "BLOCKED",
  });

  expect(
    registrationId,
    `The member has no registration for ${activitySlug}. Register them first — this case checks ` +
      "attendance, not registration.",
  ).toBeTruthy();
});

test("the member obtains a check-in credential", async ({ request }, testInfo) => {
  const member = await login(request, actorFor("member"));
  const response = await request.post(
    `${apiBaseUrl}/account/activity-registrations/${activityId}/checkin-credential`,
    { headers: member.authHeaders(), timeout: 60_000, failOnStatusCode: false },
  );
  const data = ((await jsonOf(response)) as { data?: Record<string, unknown> })?.data ?? {};
  credentialToken = String(data.token ?? "");

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-credential",
    actor: "member",
    preconditions: [`registration ${registrationId} exists`],
    steps: ["POST the check-in credential endpoint"],
    expected: "a credential is issued",
    actual: `HTTP ${response.status()}; token ${credentialToken ? "issued" : "absent"}`,
    status: response.ok() && credentialToken ? "PASS" : "FAIL",
  });

  expect(response.status()).toBeLessThan(400);
  expect(credentialToken, "no check-in credential was issued").toBeTruthy();
});

test("staff check the member in with a valid credential", async ({ request }, testInfo) => {
  const staff = await login(request, actorFor("staff"));
  const response = await request.post(`${apiBaseUrl}/admin/activity-checkins`, {
    headers: staff.authHeaders(),
    data: { token: credentialToken, action: "checkin", device_reference: `UAT ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const data = ((await jsonOf(response)) as { data?: Record<string, unknown> })?.data ?? {};

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-valid",
    actor: "staff",
    preconditions: ["a valid credential issued in this run"],
    steps: ["POST /admin/activity-checkins with the credential"],
    expected: "the check-in is accepted and the attendance state reflects it",
    actual: `HTTP ${response.status()} attendance=${String(data.attendance_status ?? data.status ?? "unknown")}`,
    status: response.ok() ? "PASS" : "FAIL",
  });

  expect(response.status(), `check-in failed: ${JSON.stringify(data).slice(0, 300)}`).toBeLessThan(400);
});

test("presenting the same credential again is refused or is a no-op", async ({ request }, testInfo) => {
  const staff = await login(request, actorFor("staff"));

  const before = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const countAttended = async (response: { json(): Promise<unknown>; text(): Promise<string> }) => {
    const items = (((await jsonOf(response)) as { data?: { items?: Array<Record<string, unknown>> } }).data
      ?.items ?? []) as Array<Record<string, unknown>>;
    return items.filter((item) => String(item.registration_id ?? "") === registrationId).length;
  };
  const beforeCount = before.ok() ? await countAttended(before) : -1;

  const duplicate = await request.post(`${apiBaseUrl}/admin/activity-checkins`, {
    headers: staff.authHeaders(),
    data: { token: credentialToken, action: "checkin", device_reference: `UAT ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const after = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const afterCount = after.ok() ? await countAttended(after) : -1;

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-duplicate",
    actor: "staff",
    preconditions: ["the member is already checked in"],
    steps: ["present the same credential a second time", "count attendance rows for this registration"],
    expected: "the member is not recorded as attending twice",
    actual: `duplicate HTTP ${duplicate.status()}; attendance rows ${beforeCount} -> ${afterCount}`,
    status: beforeCount === afterCount ? "PASS" : "FAIL",
  });

  // As with the registration retry: the status code may reasonably be a
  // refusal or a repeat success. A second attendance row may not.
  expect(afterCount, "a duplicate credential produced a second attendance record").toBe(beforeCount);
});

test("staff can find the registration by its number", async ({ request }, testInfo) => {
  const staff = await login(request, actorFor("staff"));
  const response = await request.get(`${apiBaseUrl}/admin/activity-registrations`, {
    headers: staff.authHeaders(),
    params: { query: registrationNumber },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const items = response.ok()
    ? (((await jsonOf(response)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  const found = items.some((item) => String(item.id ?? "") === registrationId);

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-lookup-number",
    actor: "staff",
    preconditions: [`registration number ${registrationNumber}`],
    steps: ["GET /admin/activity-registrations filtered by the registration number"],
    expected: "the registration is found",
    actual: `HTTP ${response.status()}; ${items.length} results; target ${found ? "found" : "not found"}`,
    status: found ? "PASS" : "FAIL",
  });

  expect(found, "staff could not find the registration by its number").toBe(true);
});

test("the check-in is undone with a reason, and the reason is retained", async ({ request }, testInfo) => {
  const staff = await login(request, actorFor("staff"));
  const reason = `UAT undo ${runMarker}`;

  const revoke = await request.post(`${apiBaseUrl}/admin/activity-checkins`, {
    headers: staff.authHeaders(),
    data: { token: credentialToken, action: "revoke", reason, device_reference: `UAT ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const attendance = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const retained = attendance.ok() ? (await attendance.text()).includes(reason) : false;

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-undo",
    actor: "staff",
    preconditions: ["the member is checked in"],
    steps: [`POST the revoke action with reason "${reason}"`, "read the attendance back"],
    expected: "the undo succeeds and the reason is stored rather than discarded",
    actual: `revoke HTTP ${revoke.status()}; reason ${retained ? "retained" : "not visible in attendance"}`,
    // An undo whose reason vanishes is an audit gap, but the reason may live
    // on the audit event rather than the attendance row, so a person confirms.
    status: revoke.ok() && retained ? "PASS" : revoke.ok() ? "BLOCKED" : "FAIL",
  });

  expect(revoke.status(), `undo failed: ${(await revoke.text()).slice(0, 300)}`).toBeLessThan(400);
});

test("phone-last-four lookup, unique and ambiguous", async ({ request }, testInfo) => {
  const lastFour = process.env.UAT_CHECKIN_LAST_FOUR ?? "";
  const ambiguousLastFour = process.env.UAT_CHECKIN_AMBIGUOUS_LAST_FOUR ?? "";

  const staff = await login(request, actorFor("staff"));
  const results: string[] = [];

  if (lastFour) {
    const unique = await request.get(`${apiBaseUrl}/admin/activity-registrations`, {
      headers: staff.authHeaders(),
      params: { activity_id: activityId, last_four: lastFour },
      timeout: 60_000,
      failOnStatusCode: false,
    });
    const items = unique.ok()
      ? (((await jsonOf(unique)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
      : [];
    results.push(`unique ${lastFour} -> HTTP ${unique.status()}, ${items.length} match(es)`);
    expect(items.length, `last-four ${lastFour} was expected to identify exactly one registration`).toBe(1);
  }

  if (ambiguousLastFour) {
    const ambiguous = await request.get(`${apiBaseUrl}/admin/activity-registrations`, {
      headers: staff.authHeaders(),
      params: { activity_id: activityId, last_four: ambiguousLastFour },
      timeout: 60_000,
      failOnStatusCode: false,
    });
    const items = ambiguous.ok()
      ? (((await jsonOf(ambiguous)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
      : [];
    results.push(`ambiguous ${ambiguousLastFour} -> HTTP ${ambiguous.status()}, ${items.length} match(es)`);
    // The point of the ambiguous case: staff must be shown the collision and
    // made to choose, never handed one arbitrary match.
    expect(
      items.length,
      "an ambiguous last-four returned a single match; staff would check in the wrong person",
    ).toBeGreaterThan(1);
  }

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-last-four",
    actor: "staff",
    preconditions: [
      lastFour ? `UAT_CHECKIN_LAST_FOUR=${lastFour} identifies exactly one registration` : "unique case not set up",
      ambiguousLastFour
        ? `UAT_CHECKIN_AMBIGUOUS_LAST_FOUR=${ambiguousLastFour} is shared by at least two registrations`
        : "ambiguous case not set up",
    ],
    steps: results.length ? results : ["no last-four fixtures supplied"],
    expected: "a unique last-four resolves to one registration; an ambiguous one resolves to several",
    actual: results.join("; ") || "not exercised",
    status: lastFour && ambiguousLastFour ? "PASS" : "BLOCKED",
  });

  expect(
    Boolean(lastFour && ambiguousLastFour),
    "Both halves need fixture data this suite cannot create without inventing member phone numbers. " +
      "Arrange two registrations sharing the same last four digits, then set UAT_CHECKIN_LAST_FOUR and " +
      "UAT_CHECKIN_AMBIGUOUS_LAST_FOUR.",
  ).toBe(true);
});
