import { expect, test } from "@playwright/test";

import {
  apiBaseUrl,
  jsonOf,
  recordEvidence,
  requireTarget,
  sessionFor,
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

  const member = await sessionFor(request, "member");
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
  // Confirmed specifically: attendance_service.credential refuses anything
  // else with CHECKIN_NOT_ELIGIBLE (service.py:1675), so an unfiltered match
  // would fail in the next test with a misleading "no credential was issued".
  const mine = items.find(
    (item) => String(item.activity_id ?? "") === activityId && String(item.status ?? "") === "confirmed",
  );
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
    `The member holds no CONFIRMED registration for ${activitySlug}. Register and confirm them ` +
      "first — this case checks attendance, not registration.",
  ).toBeTruthy();
});

test("the member obtains a check-in credential", async ({ request }, testInfo) => {
  const member = await sessionFor(request, "member");
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
  const staff = await sessionFor(request, "staff");
  const response = await request.post(`${apiBaseUrl}/admin/activity-checkins`, {
    headers: staff.authHeaders(),
    data: { token: credentialToken, action: "check_in", device_reference: `UAT ${runMarker}` },
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
  const staff = await sessionFor(request, "staff");

  const before = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  /**
   * Counting attendance ROWS for this registration cannot detect a duplicate:
   * the endpoint returns one row per confirmed registration, not one per
   * check-in event (router.py:1254), so the count is 0 or 1 however many times
   * the credential is presented. That made the old assertion unfailable.
   *
   * What does move is the checked-in headcount in the summary (router.py:1268)
   * plus this registration's own attendance_status. A duplicate must leave
   * both exactly where they were — the service early-returns and records
   * activity.checkin.duplicate_attempted instead of writing a second event
   * (service.py:1831).
   */
  const stateOf = async (response: { json(): Promise<unknown>; text(): Promise<string> }) => {
    const data = ((await jsonOf(response)) as {
      data?: { summary?: Record<string, unknown>; items?: Array<Record<string, unknown>> };
    })?.data ?? {};
    const row = (data.items ?? []).find((item) => String(item.id ?? "") === registrationId);
    return {
      checkedIn: Number(data.summary?.checked_in ?? NaN),
      attendance: String(row?.attendance_status ?? "absent"),
    };
  };
  const beforeState = before.ok() ? await stateOf(before) : { checkedIn: NaN, attendance: "unread" };

  const duplicate = await request.post(`${apiBaseUrl}/admin/activity-checkins`, {
    headers: staff.authHeaders(),
    data: { token: credentialToken, action: "check_in", device_reference: `UAT ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const after = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: staff.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const afterState = after.ok() ? await stateOf(after) : { checkedIn: NaN, attendance: "unread" };

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-duplicate",
    actor: "staff",
    preconditions: ["the member is already checked in"],
    steps: [
      "present the same credential a second time",
      "compare the checked-in headcount and this registration's attendance state",
    ],
    expected: "the member is not counted twice and their attendance state is unchanged",
    actual: `duplicate HTTP ${duplicate.status()}; checked_in ${beforeState.checkedIn} -> ${
      afterState.checkedIn
    }; attendance ${beforeState.attendance} -> ${afterState.attendance}`,
    status:
      beforeState.checkedIn === afterState.checkedIn && beforeState.attendance === afterState.attendance
        ? "PASS"
        : "FAIL",
  });

  // As with the registration retry: the status code may reasonably be a
  // refusal or a repeat success. A second head in the count may not.
  expect(
    afterState.checkedIn,
    `the checked-in headcount moved ${beforeState.checkedIn} -> ${afterState.checkedIn} on a duplicate scan`,
  ).toBe(beforeState.checkedIn);
  expect(afterState.attendance, "the duplicate changed this registration's attendance state").toBe(
    beforeState.attendance,
  );
});

test("staff can find the registration by its number", async ({ request }, testInfo) => {
  const staff = await sessionFor(request, "staff");
  const response = await request.get(`${apiBaseUrl}/admin/activity-registrations`, {
    headers: staff.authHeaders(),
    // /admin/activity-registrations accepts activity_id and nothing else
    // (activities/router.py:1022); FastAPI silently drops unknown params, so
    // `query` filtered nothing and the match has to be made client-side.
    params: { activity_id: activityId },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const items = response.ok()
    ? (((await jsonOf(response)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  // Matched on the number, not the id: "staff can find it by its number" is
  // the requirement, and an id match would pass even if registration_number
  // were absent from the payload entirely.
  const found = items.some((item) => String(item.registration_number ?? "") === registrationNumber);

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

test("check-in staff cannot undo a check-in", async ({ request }, testInfo) => {
  // activities.checkin.revoke is deliberately withheld from both
  // activity_checkin_staff and activity_manager (identity/permissions.py:1021,
  // :1024) — undo is an administrator action. Asserting the refusal first
  // means the successful undo below is evidence of authorisation working, not
  // of authorisation being absent.
  const staffSession = await sessionFor(request, "staff");
  const refused = await request.post(`${apiBaseUrl}/admin/activity-checkins`, {
    headers: staffSession.authHeaders(),
    data: { token: credentialToken, action: "revoke", reason: `UAT probe ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-undo-authorization",
    actor: "check-in staff",
    preconditions: ["the staff account holds activities.checkin.perform but not .revoke"],
    steps: ["POST the revoke action as staff"],
    expected: "403; undo is not available to floor staff",
    actual: `HTTP ${refused.status()}`,
    status: refused.status() === 403 ? "PASS" : "FAIL",
  });

  expect(
    refused.status(),
    `staff received HTTP ${refused.status()} for an undo. If this is 2xx the staff account is over-` +
      "privileged for this run and the authorisation cases below prove nothing.",
  ).toBe(403);
});

test("the check-in is undone with a reason, and the reason is retained", async ({ request }, testInfo) => {
  const reason = `UAT undo ${runMarker}`;
  // Administrator, not staff: see the authorisation case above.
  const admin = await sessionFor(request, "admin");

  const revoke = await request.post(`${apiBaseUrl}/admin/activity-checkins`, {
    headers: admin.authHeaders(),
    data: { token: credentialToken, action: "revoke", reason, device_reference: `UAT ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const attendance = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/attendance`, {
    headers: admin.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const rows = attendance.ok()
    ? (((await jsonOf(attendance)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  const row = rows.find((item) => String(item.id ?? "") === registrationId);
  // What is checkable here is the state change, not the reason text: the undo
  // reason is written to ActivityRegistrationHistory (service.py:447) and the
  // attendance endpoint returns registration_payload, which carries no reason
  // field at all (service.py:93). Scanning the response body for the string —
  // as this case used to — could only ever come back false, which would have
  // been recorded as "the reason was discarded" and read as a defect.
  const undone = row ? String(row.attendance_status ?? "") !== "checked_in" : false;

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-undo",
    actor: "administrator",
    preconditions: ["the member is checked in"],
    steps: [`POST the revoke action with reason "${reason}"`, "read the attendance state back"],
    expected: "the undo succeeds and the attendance state returns to not-checked-in",
    actual: `revoke HTTP ${revoke.status()}; attendance_status now ${
      row ? String(row.attendance_status ?? "unknown") : "row not found"
    }`,
    // The reason itself is retained in ActivityRegistrationHistory, which no
    // endpoint in this suite's reach exposes. That half stays BLOCKED rather
    // than being silently dropped from the checklist.
    status: revoke.ok() && undone ? "PASS" : "BLOCKED",
});

  expect(revoke.status(), `undo failed: ${(await revoke.text()).slice(0, 300)}`).toBeLessThan(400);
  expect(row, "the registration disappeared from the attendance list after an undo").toBeTruthy();
  expect(
    undone,
    `attendance_status is still ${String(row?.attendance_status ?? "unknown")} after a successful undo`,
  ).toBe(true);
});

test("phone-last-four lookup, unique and ambiguous", async ({ request }, testInfo) => {
  // activities.checkin.operate sits in OPERATIONS_HARDENING_PERMISSIONS
  // (identity/permissions.py:838), outside ACTIVITY_PERMISSIONS, so neither
  // activity_checkin_staff nor activity_manager holds it — the lookup is an
  // administrator capability despite reading like a floor-staff one.
  const staff = await sessionFor(request, "admin");

  /**
   * The real endpoint is POST /admin/activities/{id}/checkin/lookups
   * (checkin_operations/admin_router.py:44), not a `last_four` query
   * parameter on /admin/activity-registrations — that route accepts only
   * `activity_id` (activities/router.py:1022) and FastAPI drops unknown
   * params silently, so the earlier version of this case was filtering
   * nothing and asserting on the full guest list.
   *
   * It is a POST by deliberate design: the backend's own comment notes that a
   * four-digit fragment in a query string ends up in access logs, browser
   * history and referrers.
   *
   * The response is an outcome, not a list to be counted:
   * LookupOutcome = no_match | single_candidate | ambiguous | too_many
   * (checkin_operations/domain.py:235), with opaque choice tokens and masked
   * candidates. Above MAX_LOOKUP_CANDIDATES=8 it returns too_many with no
   * candidates at all, so an enumeration attempt gets nothing back.
   */
  const lookup = async (lastFour: string) => {
    const response = await request.post(
      `${apiBaseUrl}/admin/activities/${activityId}/checkin/lookups`,
      {
        headers: staff.authHeaders(),
        data: { last_four: lastFour, device_reference: `uat-${runMarker}` },
        timeout: 60_000,
        failOnStatusCode: false,
      },
    );
    const data = response.ok()
      ? (((await jsonOf(response)) as { data?: Record<string, unknown> })?.data ?? {})
      : {};
    return {
      status: response.status(),
      outcome: String(data.outcome ?? "unreadable"),
      candidateCount: Number(data.candidate_count ?? NaN),
      candidates: (data.candidates ?? []) as Array<Record<string, unknown>>,
      body: response.ok() ? "" : (await response.text()).slice(0, 200),
    };
  };

  /**
   * These fragments cannot be provisioned by this suite, and the reason is
   * worth stating precisely because it is not a limitation of the test.
   *
   * The lookup query requires `cp.contact_type='phone' AND cp.status='verified'`
   * (checkin_operations/service.py:369). `POST /account/contact-points` inserts
   * `status='pending_verification'` (privacy/router.py:152), and
   * `PATCH /account/contact-points/{id}` accepts only is_primary, visibility
   * and version_reason — there is no phone-verification endpoint anywhere in
   * the API (only email has one, identity/router.py:169).
   *
   * So a phone number added through the product can never become searchable.
   * The only verified phone rows in this system come from
   * cli/seed_test_showcase.py, and those still need cli/backfill_last_four_hmac.py
   * to acquire the digest the lookup matches on. Both are database-side, which
   * puts this fixture out of reach of anything that talks HTTP.
   */
  const uniqueLastFour = process.env.UAT_CHECKIN_LAST_FOUR ?? "";
  const sharedLastFour = process.env.UAT_CHECKIN_AMBIGUOUS_LAST_FOUR ?? "";

  if (!uniqueLastFour && !sharedLastFour) {
    await recordEvidence(testInfo, {
      caseId: "UAT-CHECKIN-001-last-four",
      actor: "staff",
      preconditions: ["no verified phone numbers with known last four digits on the target"],
      steps: ["none"],
      expected: "a unique fragment resolves to one candidate; a shared one is reported ambiguous",
      actual: "not exercised",
      status: "BLOCKED",
    });
    expect(
      false,
      "This case needs two confirmed attendees whose phone numbers are stored as VERIFIED and share " +
        "their last four digits. That cannot be arranged over the API: nothing in the product " +
        "verifies a phone contact point. On a non-production target, run cli/seed_test_showcase.py " +
        "followed by cli/backfill_last_four_hmac.py, then set UAT_CHECKIN_LAST_FOUR and " +
        "UAT_CHECKIN_AMBIGUOUS_LAST_FOUR. If no such path exists on this deployment, the last-four " +
        "lookup cannot match anybody in production either — that is a defect to raise, not a test to skip.",
    ).toBe(true);
    return;
  }

  const notes: string[] = [];
  let unique: Awaited<ReturnType<typeof lookup>> | null = null;
  let shared: Awaited<ReturnType<typeof lookup>> | null = null;

  if (uniqueLastFour) {
    unique = await lookup(uniqueLastFour);
    notes.push(`unique ${uniqueLastFour} -> HTTP ${unique.status} ${unique.outcome} (${unique.candidateCount})`);
  }
  if (sharedLastFour) {
    shared = await lookup(sharedLastFour);
    notes.push(`shared ${sharedLastFour} -> HTTP ${shared.status} ${shared.outcome} (${shared.candidateCount})`);
  }

  await recordEvidence(testInfo, {
    caseId: "UAT-CHECKIN-001-last-four",
    actor: "staff",
    preconditions: [
      uniqueLastFour ? `${uniqueLastFour} belongs to exactly one attendee` : "unique fragment not available",
      sharedLastFour ? `${sharedLastFour} is shared by at least two attendees` : "shared fragment not available",
      "the underlying phone contact points are stored as verified and carry a last_four_hmac digest",
    ],
    steps: notes,
    expected:
      "a unique fragment returns single_candidate; a shared one returns ambiguous with a choice per " +
      "candidate, so staff must pick rather than being handed one arbitrary match",
    actual: notes.join("; "),
    status: unique?.outcome === "single_candidate" && shared?.outcome === "ambiguous" ? "PASS" : "BLOCKED",
  });

  if (unique) {
    expect(
      unique.status,
      `lookup failed: ${unique.body}. If this is 503 the onsite check-in feature is off; if the ` +
        "outcome is no_match the lookup salt may not be configured, in which case contact points " +
        "written before the salt existed carry no searchable digest.",
    ).toBe(200);
    expect(
      unique.outcome,
      `a fragment belonging to one attendee resolved as ${unique.outcome}`,
    ).toBe("single_candidate");
  }

  if (shared) {
    expect(shared.status, `ambiguous lookup failed: ${shared.body}`).toBe(200);
    // The point of the ambiguous case: staff are shown the collision and made
    // to choose. Silently returning one match is how the wrong person gets
    // checked in.
    expect(
      shared.outcome,
      `a shared fragment resolved as ${shared.outcome}; staff would check in the wrong person`,
    ).toBe("ambiguous");
    expect(shared.candidateCount, "an ambiguous lookup offered fewer than two choices").toBeGreaterThan(1);
    for (const candidate of shared.candidates) {
      const serialized = JSON.stringify(candidate);
      // The masking promise is part of the requirement, not a nicety: a
      // candidate list that leaks whole numbers defeats the reason this is a
      // POST in the first place.
      expect(serialized, "a lookup candidate carried an unmasked phone number").not.toMatch(/\d{7,}/);
      expect(candidate.token ?? candidate.choice_token, "a candidate carried no opaque choice token").toBeTruthy();
    }
  }

  expect(
    Boolean(unique && shared),
    "Only half of this case ran. Both halves are needed: that a unique fragment resolves, and that " +
      "a colliding one refuses to guess.",
  ).toBe(true);
});
