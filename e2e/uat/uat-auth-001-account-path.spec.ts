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
 * UAT-AUTH-001 — Account path. Actor: seeded member and new test member.
 *
 * Split by what each item actually costs. Invalid login and protected-route
 * access need nothing and run always. Valid login and logout need the member
 * credentials. Registering a synthetic account writes to the target and is
 * gated accordingly — and is honest about the fact that it cannot complete
 * without an inbox.
 */

test.describe.configure({ timeout: 240_000 });

test.beforeAll(() => requireTarget({ writes: false }));

test("an invalid password is refused without revealing whether the account exists", async ({ request }, testInfo) => {
  const response = await request.post(`${apiBaseUrl}/auth/login`, {
    data: {
      email: `uat-no-such-account-${runMarker.toLowerCase()}@example.com`,
      password: "deliberately-wrong-password",
      device_name: `UAT ${runMarker}`,
    },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const body = await jsonOf(response);
  const message = JSON.stringify(body);

  await recordEvidence(testInfo, {
    caseId: "UAT-AUTH-001-invalid-login",
    actor: "anonymous visitor",
    preconditions: ["the address used does not belong to an account"],
    steps: ["POST /auth/login with a non-existent address and a wrong password"],
    expected: "401, and the response does not distinguish unknown account from wrong password",
    actual: `HTTP ${response.status()} ${message.slice(0, 200)}`,
    status: response.status() === 401 ? "PASS" : "FAIL",
  });

  expect(response.status(), "an invalid login was not refused with 401").toBe(401);
  // User enumeration: the message must not say the account is unknown.
  expect(message.toLowerCase()).not.toMatch(/not found|no such user|unknown account|does not exist/);
});

test("a protected API route refuses an anonymous caller", async ({ request }, testInfo) => {
  const probes = ["/auth/me", "/account/activity-registrations"];
  const results: string[] = [];
  for (const path of probes) {
    const response = await request.get(`${apiBaseUrl}${path}`, { timeout: 60_000, failOnStatusCode: false });
    results.push(`${path} -> ${response.status()}`);
    expect([401, 403], `${path} answered ${response.status()} to an anonymous caller`).toContain(response.status());
  }

  await recordEvidence(testInfo, {
    caseId: "UAT-AUTH-001-protected-api",
    actor: "anonymous visitor",
    preconditions: [],
    steps: probes.map((path) => `GET ${path} with no credentials`),
    expected: "each protected route answers 401 or 403",
    actual: results.join("; "),
    status: "PASS",
  });
});

test("a protected page does not render member data to an anonymous visitor", async ({ page }, testInfo) => {
  await page.goto(`${userWebUrl}/zh-CN/account/activities`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForLoadState("networkidle");
  const body = (await page.locator("body").innerText()).trim();
  const url = page.url();

  await recordEvidence(testInfo, {
    caseId: "UAT-AUTH-001-protected-route",
    actor: "anonymous visitor",
    preconditions: ["no session"],
    steps: ["open /zh-CN/account/activities directly"],
    expected: "the router sends the visitor away from the member route rather than rendering it",
    // Deliberately not asserting a specific destination: the guard's job is to
    // withhold member data, and pinning the redirect target would break on a
    // legitimate change to the login flow.
    actual: `landed on ${url}`,
    status: url.includes("/account/activities") ? "FAIL" : "PASS",
  });

  expect(url, "a member route rendered for an anonymous visitor").not.toContain("/account/activities");
  expect(body, "the page leaked a member-only heading").not.toContain("我的活动");
});

test.describe("with the member's own credentials", () => {
  test("the member can log in and read their own account", async ({ request }, testInfo) => {
    const member = actorFor("member");
    const session = await login(request, member);

    const me = await request.get(`${apiBaseUrl}/auth/me`, {
      headers: session.authHeaders(),
      timeout: 60_000,
      failOnStatusCode: false,
    });
    const body = await jsonOf(me);
    const email = String((body as { data?: { email?: string } })?.data?.email ?? "");

    await recordEvidence(testInfo, {
      caseId: "UAT-AUTH-001-login",
      actor: `member <${member.email}>`,
      preconditions: ["the member account exists and is active on the target"],
      steps: ["POST /auth/login", "GET /auth/me with the returned bearer token"],
      expected: "login succeeds and /auth/me returns the same account",
      actual: `HTTP ${me.status()}, identity ${email}`,
      status: me.ok() && email.toLowerCase() === member.email.toLowerCase() ? "PASS" : "FAIL",
    });

    expect(me.status()).toBe(200);
    expect(email.toLowerCase(), "the session belongs to a different account").toBe(member.email.toLowerCase());
  });

  test("logging out ends the session for the token that was issued", async ({ request }, testInfo) => {
    const member = actorFor("member");
    const session = await login(request, member);

    const logout = await request.post(`${apiBaseUrl}/auth/logout`, {
      headers: session.authHeaders(),
      timeout: 60_000,
      failOnStatusCode: false,
    });

    // Asserted after logout rather than assumed: a logout that leaves the
    // bearer usable is the defect this case exists to catch.
    const after = await request.get(`${apiBaseUrl}/auth/me`, {
      headers: session.authHeaders(),
      timeout: 60_000,
      failOnStatusCode: false,
    });

    await recordEvidence(testInfo, {
      caseId: "UAT-AUTH-001-logout",
      actor: `member <${member.email}>`,
      preconditions: ["an active session obtained in this test"],
      steps: ["POST /auth/logout", "GET /auth/me with the same bearer token"],
      expected: "logout succeeds and the token no longer authenticates",
      actual: `logout HTTP ${logout.status()}, subsequent /auth/me HTTP ${after.status()}`,
      status: logout.ok() && !after.ok() ? "PASS" : "FAIL",
    });

    expect(logout.status(), "logout failed").toBeLessThan(400);
    expect(after.ok(), "the access token still authenticated after logout").toBe(false);
  });
});

test("registering a new synthetic account", async ({ request }, testInfo) => {
  test.skip(!writesAllowed, "registration creates an account; set UAT_ALLOW_WRITES=yes on a non-production target");
  requireTarget({ writes: true });

  const email = `uat+${runMarker.toLowerCase()}@example.com`;
  const response = await request.post(`${apiBaseUrl}/auth/register`, {
    data: {
      email,
      password: `Uat!${runMarker}#pass`,
      preferred_locale: "zh-CN",
      timezone: "Asia/Shanghai",
    },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const body = await jsonOf(response);

  await recordEvidence(testInfo, {
    caseId: "UAT-AUTH-001-register",
    actor: "new synthetic member",
    preconditions: ["writes enabled on a non-production target"],
    steps: [`POST /auth/register for ${email}`],
    expected: "202 accepted, with verification required",
    actual: `HTTP ${response.status()} ${JSON.stringify(body).slice(0, 200)}`,
    // The account is created but cannot be verified from here: the deployment
    // has no test inbox, so the checklist's "register a new synthetic account"
    // is only half covered. Recorded as BLOCKED rather than PASS so the gap is
    // visible in the evidence bundle.
    status: response.status() === 202 ? "BLOCKED" : "FAIL",
    defects: [],
  });

  expect(response.status(), "registration was not accepted").toBe(202);
  expect(
    process.env.UAT_MAIL_API_URL,
    `Account ${email} was created but cannot be verified: the deployment exposes no test inbox. ` +
      "Complete the verification by hand and record it, or set UAT_MAIL_API_URL if the target has one. " +
      "Remember to remove this account afterwards — it is prefixed with the run marker.",
  ).toBeTruthy();
});
