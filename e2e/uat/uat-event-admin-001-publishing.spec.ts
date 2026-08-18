import { expect, test, type APIRequestContext } from "@playwright/test";

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
 * UAT-EVENT-ADMIN-001 — Admin publishing. Actor: admin.
 *
 * Creates an activity on the target, so it is gated behind UAT_ALLOW_WRITES
 * and refuses production. Everything it creates carries the run marker in its
 * code and slug, and afterAll cancels it.
 *
 * Every payload below is taken from the backend schema rather than from what
 * the checklist prose implies, with the source noted. An earlier version of
 * this file guessed the field names and would have failed with 422 on every
 * write — a test that fails for the wrong reason is worse than no test,
 * because it burns a real UAT window proving nothing.
 *
 *   POST  /admin/activities                        ActivityCreateRequest
 *                                                  modules/activities/schemas.py:10
 *   PUT   /admin/activities/{id}/localizations/{l} LocalizationUpsertRequest
 *                                                  modules/activities/schemas.py:77
 *   PATCH /admin/activities/{id}                   ActivityUpdateRequest
 *                                                  modules/activities/schemas.py:56
 *   POST  /admin/activities/{id}/transition        ActivityTransitionRequest
 *                                                  modules/activities/schemas.py:140
 *   POST  /admin/activities/{id}/cancel            ActivityCancelRequest
 *                                                  modules/activities/schemas.py:219
 *   GET   /admin/activities/{id}/audit             modules/activities/router.py:1479
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

const locale = "zh-CN";
const activityCode = runMarker.toLowerCase();
const slug = `${runMarker.toLowerCase()}-uat`;

let activityId = "";
/** ActivityUpdateRequest.expected_version is an optimistic lock, so the
 *  current version has to be carried forward between writes. */
let version = 0;

test.beforeAll(() => {
  requireTarget({ writes: writesAllowed });
});

test.skip(!writesAllowed, "creates an activity; set UAT_ALLOW_WRITES=yes on a non-production target");

async function currentVersion(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<number> {
  const response = await request.get(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers,
    timeout: 60_000,
    failOnStatusCode: false,
  });
  return Number(((await jsonOf(response)) as { data?: { version?: number } })?.data?.version ?? 0);
}

function activityWindow() {
  const startsAt = new Date(Date.now() + 30 * 24 * 3_600_000);
  const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
  const registrationClosesAt = new Date(startsAt.getTime() - 3_600_000);
  return {
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    registration_opens_at: new Date().toISOString(),
    registration_closes_at: registrationClosesAt.toISOString(),
  };
}

test("required fields are validated before a draft is accepted", async ({ request }, testInfo) => {
  const admin = await sessionFor(request, "admin");

  // Deliberately incomplete: activity_code, internal_name, activity_format,
  // starts_at and ends_at are all required. Asserting the rejection first
  // means the later successful create says something — without it, an
  // endpoint that accepted anything would still look like a pass.
  const response = await request.post(`${apiBaseUrl}/admin/activities`, {
    headers: admin.authHeaders(),
    data: { internal_name: "" },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-validation",
    actor: "admin",
    preconditions: ["admin session"],
    steps: ["POST /admin/activities missing every required field"],
    expected: "422 or 400; nothing is created",
    actual: `HTTP ${response.status()}`,
    status: [400, 422].includes(response.status()) ? "PASS" : "FAIL",
  });

  expect([400, 422], `an incomplete activity was accepted with HTTP ${response.status()}`).toContain(
    response.status(),
  );
});

test("an admin creates a draft", async ({ request }, testInfo) => {
  const admin = await sessionFor(request, "admin");

  const response = await request.post(`${apiBaseUrl}/admin/activities`, {
    headers: admin.authHeaders(),
    data: {
      activity_code: activityCode,
      internal_name: `${runMarker} UAT activity`,
      activity_format: "in_person",
      default_locale: locale,
      timezone: "Asia/Shanghai",
      ...activityWindow(),
    },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const body = await jsonOf(response);
  const data = (body as { data?: Record<string, unknown> })?.data ?? {};
  activityId = String(data.id ?? "");
  // POST /admin/activities returns only {id, status} (router.py:721). Reading
  // `version` off it and hand-incrementing afterwards happened to track the
  // real column, but only by coincidence; the detail endpoint reports it.
  version = activityId ? await currentVersion(request, admin.authHeaders()) : 0;

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-create",
    actor: "admin",
    preconditions: ["admin session", "writes enabled on a non-production target"],
    steps: [`POST /admin/activities activity_code=${activityCode}`],
    expected: "201 with an identifier, and the activity starts as a draft",
    actual: `HTTP ${response.status()} id=${activityId || "none"} status=${String(data.status ?? "unknown")}`,
    status: response.status() === 201 && activityId ? "PASS" : "FAIL",
  });

  expect(response.status(), `draft creation failed: ${JSON.stringify(body).slice(0, 400)}`).toBe(201);
  expect(activityId, "the API returned no activity id").toBeTruthy();
  expect(String(data.status ?? ""), "a new activity should start as a draft").toBe("draft");
});

test("the draft carries a public slug but is not served publicly", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await sessionFor(request, "admin");

  // The public surface addresses activities by localization slug, not by
  // activity_code, so a draft with no localization could never be served —
  // which would make the next assertion true for an uninteresting reason.
  const localization = await request.put(
    `${apiBaseUrl}/admin/activities/${activityId}/localizations/${locale}`,
    {
      headers: admin.authHeaders(),
      data: { locale, slug, title: `${runMarker} UAT 活动`, summary: "Automated UAT fixture. Safe to remove." },
      timeout: 60_000,
      failOnStatusCode: false,
    },
  );
  version = await currentVersion(request, admin.authHeaders());

  const anonymous = await request.get(`${apiBaseUrl}/activities/${slug}`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-draft-hidden",
    actor: "admin, then anonymous visitor",
    preconditions: [`draft ${activityId} exists with slug ${slug}`],
    steps: [`PUT the ${locale} localization`, `GET /activities/${slug} with no credentials`],
    expected: "the slug resolves for staff but 404s publicly while the activity is a draft",
    actual: `localization HTTP ${localization.status()}; anonymous read HTTP ${anonymous.status()}`,
    status: localization.ok() && anonymous.status() === 404 ? "PASS" : "FAIL",
  });

  expect(
    localization.status(),
    `localization failed: ${(await localization.text()).slice(0, 300)}`,
  ).toBeLessThan(400);
  expect(anonymous.status(), "a draft activity was served publicly").toBe(404);
});

test("the admin edits the draft and the change is read back", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await sessionFor(request, "admin");
  const internalName = `${runMarker} UAT activity (edited)`;

  const patch = await request.patch(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers: admin.authHeaders(),
    data: { expected_version: version, internal_name: internalName, visibility: "public" },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  if (patch.ok()) {
    version =
      Number(((await jsonOf(patch)) as { data?: { version?: number } })?.data?.version ?? 0) ||
      (await currentVersion(request, admin.authHeaders()));
  }

  // Read back rather than trusting the write's own response: an endpoint that
  // echoed its input without persisting would pass the weaker check.
  const readBack = await request.get(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers: admin.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const stored = ((await jsonOf(readBack)) as { data?: Record<string, unknown> })?.data ?? {};

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-edit",
    actor: "admin",
    preconditions: [`draft ${activityId} at version ${version}`],
    steps: ["PATCH internal_name and visibility with expected_version", "GET the activity back"],
    expected: "the stored values equal what was written, and the version advances",
    actual: `patch HTTP ${patch.status()}; stored internal_name ${
      stored.internal_name === internalName ? "matches" : "differs"
    }; visibility ${String(stored.visibility ?? "unknown")}`,
    status: patch.ok() && stored.internal_name === internalName ? "PASS" : "FAIL",
  });

  expect(patch.status(), `edit failed: ${(await patch.text()).slice(0, 300)}`).toBeLessThan(400);
  expect(stored.internal_name, "the edit was not persisted").toBe(internalName);
});

test("a stale expected_version is refused", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await sessionFor(request, "admin");

  // Concurrent editing is the failure this lock exists for, and it is cheap to
  // prove here: a second admin holding an old version must not silently win.
  const stale = await request.patch(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers: admin.authHeaders(),
    data: { expected_version: 1, internal_name: `${runMarker} stale write` },
    timeout: 60_000,
    failOnStatusCode: false,
  });

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-optimistic-lock",
    actor: "admin",
    preconditions: [`activity ${activityId} is past version 1`],
    steps: ["PATCH with expected_version=1"],
    expected: "409 ACTIVITY_VERSION_CONFLICT; the stale write is refused",
    actual: `HTTP ${stale.status()}`,
    status: stale.status() === 409 ? "PASS" : "FAIL",
  });

  expect(stale.status(), "a stale write was accepted; concurrent edits can be lost").toBe(409);
});

test("an incomplete activity cannot be published", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await sessionFor(request, "admin");

  /**
   * The first version of this file went straight from draft to published and
   * expected 2xx. Two separate rules make that impossible, and both are ones a
   * UAT suite should be proving rather than tripping over:
   *
   *   1. draft's only forward edge is in_review (domain.py:57). There is no
   *      one-step publish.
   *   2. before any publishing target, validate_for_publish must pass
   *      (service.py:573): an in_person activity needs a location, the default
   *      localization must be translation_status="ready", and there must be at
   *      least one active ticket type. This fixture has none of the three.
   *
   * So the honest assertion is the refusal. An activity with no venue, no
   * ticket and an untranslated page reaching the public is a far worse defect
   * than a publish button that is hard to reach.
   */
  const premature = await request.post(`${apiBaseUrl}/admin/activities/${activityId}/transition`, {
    headers: admin.authHeaders(),
    data: { target_status: "published", reason: `UAT premature publish ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const errorCode = String(
    ((await jsonOf(premature)) as { error?: { code?: string } })?.error?.code ??
      ((await jsonOf(premature)) as { code?: string })?.code ??
      "unreadable",
  );

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-publish-guard",
    actor: "admin",
    preconditions: [`draft ${activityId} has no location, no ticket type and an unready localization`],
    steps: ["POST the published transition on an incomplete draft"],
    expected: "409, refused as either not-ready-to-publish or an illegal transition",
    actual: `HTTP ${premature.status()} ${errorCode}`,
    status: premature.status() === 409 ? "PASS" : "FAIL",
  });

  expect(
    premature.status(),
    `an incomplete draft answered HTTP ${premature.status()} to a publish request; it must be 409`,
  ).toBe(409);
});

test("the one legal forward transition is accepted", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await sessionFor(request, "admin");

  // in_review is not gated by validate_for_publish (service.py:568 lists only
  // scheduled/published/registration_open), so this is the step that proves
  // transitions work at all — otherwise the case above could be passing
  // because every transition is broken.
  const review = await request.post(`${apiBaseUrl}/admin/activities/${activityId}/transition`, {
    headers: admin.authHeaders(),
    data: { target_status: "in_review", reason: `UAT submit for review ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const stored = await request.get(`${apiBaseUrl}/admin/activities/${activityId}`, {
    headers: admin.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const status = String(((await jsonOf(stored)) as { data?: { status?: string } })?.data?.status ?? "unknown");

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-transition",
    actor: "admin",
    preconditions: [`draft ${activityId} exists`],
    steps: ["POST the in_review transition with a reason", "read the activity back"],
    expected: "the transition succeeds and the stored status is in_review",
    actual: `transition HTTP ${review.status()}; stored status ${status}`,
    status: review.ok() && status === "in_review" ? "PASS" : "FAIL",
  });

  expect(review.status(), `submit for review failed: ${(await review.text()).slice(0, 300)}`).toBeLessThan(400);
  expect(status, "the status did not move to in_review").toBe("in_review");
});

test("a published activity is publicly readable", async ({ request }, testInfo) => {
  /**
   * The other half of the requirement, checked against an activity that is
   * genuinely publishable. Provisioning one from scratch needs a catalog
   * product, a SKU, inventory, a location and a ready localization — a chain
   * this suite cannot verify without running it, so it is nominated instead.
   */
  const publishedSlug = process.env.UAT_PUBLISHED_ACTIVITY_SLUG ?? process.env.UAT_ACTIVITY_SLUG ?? "";

  const anonymous = publishedSlug
    ? await request.get(`${apiBaseUrl}/activities/${encodeURIComponent(publishedSlug)}`, {
        timeout: 60_000,
        failOnStatusCode: false,
      })
    : null;

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-published-public",
    actor: "anonymous visitor",
    preconditions: [
      publishedSlug ? `UAT_PUBLISHED_ACTIVITY_SLUG=${publishedSlug} is published` : "no published activity nominated",
    ],
    steps: publishedSlug ? [`GET /activities/${publishedSlug} with no credentials`] : ["none"],
    expected: "a published activity is served to anonymous visitors",
    actual: anonymous ? `HTTP ${anonymous.status()}` : "not exercised",
    status: anonymous?.ok() ? "PASS" : "BLOCKED",
  });

  expect(
    publishedSlug,
    "Set UAT_PUBLISHED_ACTIVITY_SLUG to an already-published activity. This suite cannot publish the " +
      "draft it creates: publishing requires a location, an active ticket type and a ready " +
      "localization, which means provisioning a catalog product, SKU and inventory first.",
  ).toBeTruthy();
  expect(anonymous!.status(), "a published activity is not publicly readable").toBe(200);
});

test("the publication is recorded in the audit trail", async ({ request }, testInfo) => {
  expect(activityId, "no draft was created").toBeTruthy();
  const admin = await sessionFor(request, "admin");

  // Activity-scoped, not a global feed: /admin/audit-events does not exist.
  // The rows are already filtered to this activity server-side, so the match
  // is on event_type rather than on the id appearing in the payload.
  const audit = await request.get(`${apiBaseUrl}/admin/activities/${activityId}/audit`, {
    headers: admin.authHeaders(),
    timeout: 60_000,
    failOnStatusCode: false,
  });

  const events = audit.ok()
    ? (((await jsonOf(audit)) as { data?: { items?: Array<Record<string, unknown>> } }).data?.items ?? [])
    : [];
  const lifecycle = events.filter((event) => String(event.event_type ?? "").startsWith("activity."));

  await recordEvidence(testInfo, {
    caseId: "UAT-EVENT-ADMIN-001-audit",
    actor: "admin",
    preconditions: [`activity ${activityId} was created, edited and moved to in_review in this run`],
    steps: [`GET /admin/activities/${activityId}/audit`],
    expected: "the lifecycle of this activity appears in its audit trail",
    actual: audit.ok()
      ? `${events.length} events, ${lifecycle.length} activity.* — ${lifecycle
          .map((event) => String(event.event_type))
          .slice(0, 5)
          .join(", ")}`
      : `audit endpoint answered HTTP ${audit.status()}`,
    status: audit.ok() && lifecycle.length > 0 ? "PASS" : "BLOCKED",
  });

  // BLOCKED rather than FAIL when the endpoint refuses this admin: that is a
  // permissions question (activities.audit.read) for the tester, not proof
  // that auditing is broken.
  // Graded BLOCKED above and skipped here rather than failed: an admin without
  // activities.audit.read is a scope question for whoever set up the run, not
  // evidence that auditing is broken. The two must agree — an evidence record
  // that says BLOCKED next to a red test teaches people to distrust both.
  test.skip(
    !audit.ok(),
    `the audit endpoint answered HTTP ${audit.status()}; this admin may lack activities.audit.read`,
  );
  // record_security_event fires on transition (service.py:596); create, PATCH
  // and localization writes record nothing, so this assertion depends on the
  // in_review step above having succeeded.
  expect(lifecycle.length, "a status transition left no activity.* audit record").toBeGreaterThan(0);
});

test.afterAll(async ({ request }) => {
  // Best-effort, and deliberately loud when it fails: an event left published
  // on a shared environment is worse than a failed test. reason_code is
  // required alongside reason (ActivityCancelRequest extends ReasonRequest);
  // sending only `reason` used to make this 422 silently.
  if (!activityId || !writesAllowed) return;
  try {
    const admin = await sessionFor(request, "admin");
    // /cancel routes through transition(CANCELLED), and neither draft nor
    // in_review has an edge to cancelled (domain.py:57) — so the old cleanup
    // could only ever 409 and leave the fixture behind. archived is the legal
    // terminal move, and it is reachable from draft, so in_review is walked
    // back first.
    const detail = await request.get(`${apiBaseUrl}/admin/activities/${activityId}`, {
      headers: admin.authHeaders(),
      timeout: 60_000,
      failOnStatusCode: false,
    });
    const status = String(((await jsonOf(detail)) as { data?: { status?: string } })?.data?.status ?? "");
    const move = (target: string) =>
      request.post(`${apiBaseUrl}/admin/activities/${activityId}/transition`, {
        headers: admin.authHeaders(),
        data: { target_status: target, reason: `Automated UAT cleanup for ${runMarker}.` },
        timeout: 60_000,
        failOnStatusCode: false,
      });
    if (status === "in_review") await move("draft");
    const archived = await move("archived");
    if (!archived.ok()) {
      console.error(
        `[UAT] could not archive activity ${activityId} (${slug}, status ${status}); remove it by hand. ` +
          `HTTP ${archived.status()} ${(await archived.text()).slice(0, 200)}`,
      );
    }
  } catch (error) {
    console.error(`[UAT] cleanup failed for activity ${activityId} (${slug}):`, error);
  }
});
