import { expect, test } from "@playwright/test";

import { apiBaseUrl, recordEvidence, requireTarget, userWebUrl, writesAllowed } from "./uat-context";

/**
 * Preflight from references/UAT_CHECKLIST.md.
 *
 * Everything here is machine-checkable except the last two items, which are
 * reported as BLOCKED rather than skipped. A skipped check reads as absent; a
 * BLOCKED one says a person still owes an answer, which is the truth.
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

test.describe("items a person still owes", () => {
  // Reported, never skipped. The checklist asks for migration reruns, seed
  // repeatability, monitoring and an isolated restore target; none of those can
  // be observed from outside the deployment, and inventing a pass for them is
  // the failure mode the evidence contract exists to prevent.
  const humanItems = [
    ["PREFLIGHT-migrations", "migration from clean state and rerun succeed"],
    ["PREFLIGHT-seeds", "synthetic seeds are repeatable"],
    ["PREFLIGHT-identities", "test identities and roles are verified"],
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
