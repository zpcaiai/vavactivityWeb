import { expect, test } from "@playwright/test";

import {
  actorFor,
  apiBaseUrl,
  jsonOf,
  identityPrefix,
  sessionFor,
  recordEvidence,
  requireTarget,
  userWebUrl,
  writesAllowed,
} from "./uat-context";

/**
 * Preflight from references/UAT_CHECKLIST.md.
 *
 * Everything here is machine-checkable except the four items in the last
 * block, which are reported as BLOCKED rather than skipped. A skipped check
 * reads as absent; a BLOCKED one says a person still owes an answer, which is
 * the truth.
 *
 * PREFLIGHT-identities used to sit in that block and no longer does: it turned
 * out to be observable from outside the deployment, so it is executed. Being
 * strict about what genuinely cannot be checked only means something if the
 * list stays honest in the other direction too.
 */

test.describe.configure({ timeout: 240_000 });

test.beforeAll(() => requireTarget({ writes: false }));

test("the target identifies the exact build it is running", async ({ request }, testInfo) => {
  // "External UAT deployment identifies exact commit/image digest." The API
  // does not expose its commit, so the honest thing is to require the tester
  // to supply it and to fail when they have not, rather than to record UAT
  // evidence against an unidentified build.
  const backend = process.env.UAT_BACKEND_COMMIT ?? "";
  const frontend = process.env.UAT_FRONTEND_COMMIT ?? "";

  await recordEvidence(testInfo, {
    caseId: "PREFLIGHT-build-identity",
    actor: "tester",
    preconditions: ["UAT_BACKEND_COMMIT and UAT_FRONTEND_COMMIT are set to the deployed commits"],
    steps: ["read the commit identifiers supplied for this run"],
    expected: "both commits are recorded",
    actual: `backend=${backend || "UNRECORDED"} frontend=${frontend || "UNRECORDED"}`,
    status: backend && frontend ? "PASS" : "BLOCKED",
  });

  expect(
    backend,
    "UAT_BACKEND_COMMIT is required: evidence against an unidentified build cannot be re-checked",
  ).toBeTruthy();
  expect(frontend, "UAT_FRONTEND_COMMIT is required").toBeTruthy();
});

test("the user app, the API and the OpenAPI document are reachable", async ({ request }, testInfo) => {
  const reachable: Record<string, number> = {};

  const web = await request.get(userWebUrl, { timeout: 120_000, failOnStatusCode: false });
  reachable[userWebUrl] = web.status();

  const live = await request.get(`${apiBaseUrl}/health/live`, { timeout: 120_000, failOnStatusCode: false });
  reachable[`${apiBaseUrl}/health/live`] = live.status();

  // OpenAPI is disabled outside development on purpose, so its absence is
  // recorded rather than asserted — failing on it would punish a correctly
  // hardened deployment.
  const openapi = await request.get(`${apiBaseUrl.replace(/\/api\/v1$/, "")}/openapi.json`, {
    timeout: 60_000,
    failOnStatusCode: false,
  });
  reachable["openapi.json"] = openapi.status();

  await recordEvidence(testInfo, {
    caseId: "PREFLIGHT-reachability",
    actor: "anonymous",
    preconditions: ["target URLs supplied"],
    steps: ["GET user web root", "GET /health/live", "GET /openapi.json"],
    expected: "user web and liveness answer 2xx; OpenAPI may be disabled in a hardened deployment",
    actual: JSON.stringify(reachable),
    status: web.ok() && live.ok() ? "PASS" : "FAIL",
  });

  expect(web.status(), "user web is unreachable").toBeLessThan(400);
  expect(live.status(), "API liveness is unreachable").toBe(200);
});

test("PostgreSQL and Redis are healthy, or their absence is explicit", async ({ request }, testInfo) => {
  // Retried because a free-tier database reports unavailable while it opens
  // its first connection; see the smoke suite for the same reasoning.
  const attempts = [0, 5_000, 10_000, 20_000];
  let dependencies: Record<string, string> = {};
  for (const [index, delay] of attempts.entries()) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await request.get(`${apiBaseUrl}/health/ready`, { timeout: 45_000, failOnStatusCode: false });
    dependencies = ((await response.json()) as { data?: { dependencies?: Record<string, string> } })?.data
      ?.dependencies ?? {};
    if (dependencies.postgresql === "ok") break;
    if (index === attempts.length - 1) break;
  }

  await recordEvidence(testInfo, {
    caseId: "PREFLIGHT-dependencies",
    actor: "anonymous",
    preconditions: ["API is reachable"],
    steps: ["GET /health/ready, retrying while a dependency is still waking"],
    expected: "postgresql reports ok; redis reports ok or an explicit disabled",
    actual: JSON.stringify(dependencies),
    status: dependencies.postgresql === "ok" ? "PASS" : "FAIL",
  });

  expect(dependencies.postgresql, `postgresql never became available: ${JSON.stringify(dependencies)}`).toBe("ok");
  // "disabled" is a real answer: it says the deployment knows Redis is absent,
  // which is different from a check that silently passed.
  expect(["ok", "disabled"], `unexpected redis state: ${dependencies.redis}`).toContain(dependencies.redis);
});

test("write-mutating cases are gated, and the gate is reported either way", async ({}, testInfo) => {
  // Not an assertion about the deployment — an assertion about this run, so
  // the evidence bundle says plainly which half of the checklist it covers.
  await recordEvidence(testInfo, {
    caseId: "PREFLIGHT-write-scope",
    actor: "tester",
    preconditions: [],
    steps: ["read UAT_ALLOW_WRITES"],
    expected: "the run states whether mutating cases were in scope",
    actual: writesAllowed
      ? "writes enabled: admin publishing, registration, waitlist and check-in cases will run"
      : "writes disabled: only the read-only cases run; UAT-EVENT-ADMIN-001, UAT-REG-001, UAT-REG-002 and UAT-CHECKIN-001 are NOT covered",
    status: "PASS",
  });
});

/**
 * PREFLIGHT-identities, executed rather than attested.
 *
 * This was on the human-owed list in the first version of this suite, which
 * was a misjudgement: "the test identities and their roles are what we think
 * they are" is observable from outside the deployment — log in and read
 * /auth/me. The other four items on that list genuinely are not.
 *
 * The assertion is deliberately about separation rather than about a fixed
 * permission list. Naming exact permissions would make this file a second,
 * silently-drifting copy of the permission matrix; what a UAT run needs to
 * establish is that the accounts it is about to use are actually distinct
 * principals with the authority their role implies, and that the member
 * account is not quietly an administrator.
 */
test("the test identities are distinct principals with the roles they claim", async ({ request }, testInfo) => {
  requireTarget({ writes: false });

  const roles = ["member", "admin"] as const;
  const seen: Array<{ role: string; email: string; userId: string; permissionCount: number }> = [];
  const missing: string[] = [];

  for (const role of roles) {
    let actor;
    try {
      actor = actorFor(role);
    } catch {
      missing.push(role);
      continue;
    }
    void actor;
    const session = await sessionFor(request, role);
    // Audience matters: an admin token does not decode on /auth/me.
    const me = await request.get(`${apiBaseUrl}${identityPrefix(role)}/auth/me`, {
      headers: session.authHeaders(),
      timeout: 60_000,
      failOnStatusCode: false,
    });
    const data = ((await jsonOf(me)) as { data?: Record<string, unknown> })?.data ?? {};
    const permissions = (data.permissions ?? []) as string[];
    seen.push({
      role,
      // The account is named so a wrong-account run is legible afterwards.
      email: String(data.email ?? actorFor(role).email),
      userId: String(data.id ?? ""),
      permissionCount: permissions.length,
    });

    expect(
      me.status(),
      `${identityPrefix(role)}/auth/me failed for the ${role} account with HTTP ${me.status()}`,
    ).toBe(200);
    expect(String(data.id ?? ""), `/auth/me returned no id for the ${role} account`).toBeTruthy();

    if (role === "admin") {
      expect(
        permissions.length,
        "the admin account holds no permissions; admin-side cases would fail for the wrong reason",
      ).toBeGreaterThan(0);
    }
    if (role === "member") {
      // The member account being an administrator would make every
      // authorization assertion in this suite meaningless — a 403 that never
      // happens looks exactly like a 403 that is correctly enforced.
      const administrative = permissions.filter((permission) => permission.startsWith("activities."));
      expect(
        administrative,
        `the member account carries administrative permissions (${administrative.join(", ")}); ` +
          "use an ordinary member account or the access-control cases prove nothing",
      ).toHaveLength(0);
    }
  }

  const distinct = new Set(seen.map((entry) => entry.userId)).size === seen.length;

  await recordEvidence(testInfo, {
    caseId: "PREFLIGHT-identities",
    actor: "each configured actor in turn",
    preconditions: ["UAT_MEMBER_* and UAT_ADMIN_* name accounts that exist on the target"],
    steps: ["log in as each actor", "GET /auth/me", "compare identity and authority"],
    expected: "each actor is a distinct principal, and the member holds no administrative permissions",
    actual: seen
      .map((entry) => `${entry.role}=${entry.email} id=${entry.userId.slice(0, 8)} perms=${entry.permissionCount}`)
      .join("; ") + (missing.length ? ` (not configured: ${missing.join(", ")})` : ""),
    status: missing.length ? "BLOCKED" : distinct ? "PASS" : "FAIL",
  });

  expect(missing, `these actors are not configured: ${missing.join(", ")}`).toHaveLength(0);
  expect(distinct, "two actors resolved to the same user; role separation is not being tested").toBe(true);
});

test.describe("items a person still owes", () => {
  // Reported, never skipped. The checklist asks for migration reruns, seed
  // repeatability, monitoring and an isolated restore target; none of those can
  // be observed from outside the deployment, and inventing a pass for them is
  // the failure mode the evidence contract exists to prevent.
  const humanItems = [
    ["PREFLIGHT-migrations", "migration from clean state and rerun succeed"],
    ["PREFLIGHT-seeds", "synthetic seeds are repeatable"],
    ["PREFLIGHT-monitoring", "monitoring and logs are available and sanitized"],
    ["PREFLIGHT-backup", "a backup exists and the restore target is isolated"],
  ] as const;

  for (const [caseId, description] of humanItems) {
    test(`${caseId}: ${description}`, async ({}, testInfo) => {
      const attested = (process.env.UAT_ATTESTED ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const isAttested = attested.includes(caseId);

      await recordEvidence(testInfo, {
        caseId,
        actor: "operator",
        preconditions: ["deployment access outside the public surface"],
        steps: [`operator confirms: ${description}`],
        expected: "attested by a named person, with the underlying command output retained",
        actual: isAttested
          ? `attested via UAT_ATTESTED by ${process.env.UAT_TESTER ?? "UNIDENTIFIED"}`
          : "not attested",
        status: isAttested ? "PASS" : "BLOCKED",
      });

      expect(
        isAttested,
        `${description} cannot be observed from outside the deployment. Confirm it, then add ` +
          `${caseId} to UAT_ATTESTED and name yourself in UAT_TESTER. Do not add it without checking.`,
      ).toBe(true);
    });
  }
});
