import { expect, type APIRequestContext, type TestInfo } from "@playwright/test";

/**
 * Shared context for the UAT cases in references/UAT_CHECKLIST.md.
 *
 * Everything dangerous about this suite is concentrated here on purpose. Half
 * the checklist mutates the target — creating events, registering, cancelling,
 * promoting from a waitlist, checking people in — and several of those change
 * state other people can see. So the safety properties live in one file where
 * they can be read in one sitting, rather than being repeated (and eventually
 * forgotten) in six spec files:
 *
 *   - writes require an explicit opt-in, and refuse known production hosts;
 *   - credentials only ever come from the environment, never from the repo;
 *   - everything created is prefixed with a run marker so it can be found and
 *     cleaned up afterwards;
 *   - each case records the evidence fields the checklist asks for.
 */

export const userWebUrl = (process.env.UAT_USER_WEB_URL ?? "").replace(/\/+$/, "");
export const adminWebUrl = (process.env.UAT_ADMIN_WEB_URL ?? "").replace(/\/+$/, "");
export const apiBaseUrl = (process.env.UAT_API_BASE_URL ?? "").replace(/\/+$/, "");

/**
 * Hosts that must never receive writes from this suite.
 *
 * Defaulted to the known production deployment rather than left empty: an
 * empty default would make the guard opt-in, and a guard nobody remembers to
 * opt into is not a guard. Override only to point at a different production.
 */
const productionHosts = (
  process.env.UAT_PRODUCTION_HOSTS ?? "vavactivity.vercel.app,vav-platform-api.onrender.com"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

export const writesAllowed = (process.env.UAT_ALLOW_WRITES ?? "").toLowerCase() === "yes";

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
}

/** Every case calls this. Read-only cases pass `writes: false`. */
export function requireTarget({ writes }: { writes: boolean }): void {
  const missing = [
    ["UAT_USER_WEB_URL", userWebUrl],
    ["UAT_ADMIN_WEB_URL", adminWebUrl],
    ["UAT_API_BASE_URL", apiBaseUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`UAT needs a real target; missing ${missing.join(", ")}.`);
  }

  const local = [userWebUrl, adminWebUrl, apiBaseUrl].filter(isLocal);
  if (local.length) {
    throw new Error(
      `UAT is external by definition and cannot target localhost: ${local.join(", ")}. ` +
        "Local evidence recorded as UAT is the 'sandbox evidence presented as live' blocker.",
    );
  }

  if (!writes) return;

  if (!writesAllowed) {
    throw new Error(
      "This case creates data on the target. Set UAT_ALLOW_WRITES=yes to acknowledge that, " +
        "and point the target at a non-production deployment.",
    );
  }

  const production = [userWebUrl, adminWebUrl, apiBaseUrl]
    .map(hostOf)
    .filter((host) => productionHosts.includes(host));
  if (production.length) {
    throw new Error(
      `Refusing to write to production: ${[...new Set(production)].join(", ")}. ` +
        "Registrations, waitlist promotions and check-ins are visible to real members and " +
        "leave audit records that cannot be fully withdrawn. Use a staging deployment, or " +
        "override UAT_PRODUCTION_HOSTS if these hosts are genuinely not production.",
    );
  }
}

/**
 * A stable, greppable marker for everything this run creates.
 *
 * Derived from the clock at import time so one run shares one marker, and
 * carried in every title and slug the suite writes, so anything left behind
 * after a failed run can be found and removed by hand.
 */
export const runMarker = `UAT-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;

export interface Actor {
  readonly role: "member" | "member2" | "admin" | "staff";
  readonly email: string;
  readonly password: string;
}

const actorEnv: Record<Actor["role"], [string, string]> = {
  member: ["UAT_MEMBER_EMAIL", "UAT_MEMBER_PASSWORD"],
  member2: ["UAT_MEMBER_2_EMAIL", "UAT_MEMBER_2_PASSWORD"],
  admin: ["UAT_ADMIN_EMAIL", "UAT_ADMIN_PASSWORD"],
  staff: ["UAT_STAFF_EMAIL", "UAT_STAFF_PASSWORD"],
};

/**
 * Credentials come from the environment and are never written anywhere — not
 * to a fixture, not to an attachment, not to a trace annotation. The password
 * is read once and handed straight to the login call.
 */
export function actorFor(role: Actor["role"]): Actor {
  const [emailVar, passwordVar] = actorEnv[role];
  const email = process.env[emailVar] ?? "";
  const password = process.env[passwordVar] ?? "";
  if (!email || !password) {
    throw new Error(
      `This case acts as the ${role}; set ${emailVar} and ${passwordVar}. ` +
        "Use accounts that exist on the target already — this suite does not create identities.",
    );
  }
  return { role, email, password };
}

export interface Session {
  readonly actor: Actor;
  readonly accessToken: string;
  readonly userId: string;
  readonly permissions: readonly string[];
  authHeaders(): Record<string, string>;
}

/**
 * Log in over the API and keep the bearer token.
 *
 * The API issues both a cookie and an `access_token`, and the checklist
 * requires data/API assertions rather than screenshots, so the token is what
 * the assertions run against. Browser-level login is exercised separately in
 * the cases that are about the browser.
 */
export async function login(request: APIRequestContext, actor: Actor): Promise<Session> {
  const path = actor.role === "admin" || actor.role === "staff" ? "/admin/auth/login" : "/auth/login";
  const response = await request.post(`${apiBaseUrl}${path}`, {
    data: { email: actor.email, password: actor.password, device_name: `UAT ${runMarker}` },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  expect(
    response.status(),
    // The email is named because a wrong-account failure is otherwise very
    // hard to tell from a wrong-password one; the password never appears.
    `login failed for ${actor.role} <${actor.email}> at ${path}: ${response.status()}`,
  ).toBe(200);
  const body = await response.json();
  const accessToken = body?.data?.access_token ?? "";
  expect(accessToken, "login returned no access token").toBeTruthy();
  return {
    actor,
    accessToken,
    userId: body?.data?.user?.id ?? "",
    permissions: body?.data?.user?.permissions ?? [],
    authHeaders: () => ({ authorization: `Bearer ${accessToken}` }),
  };
}

export interface EvidenceRecord {
  caseId: string;
  actor: string;
  preconditions: string[];
  steps: string[];
  expected: string;
  actual: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  defects?: string[];
}

/**
 * Attach the evidence fields the checklist requires.
 *
 * "No screenshot alone substitutes for data/API assertions", so `actual` is
 * expected to carry values read back from the API rather than a description of
 * what the page looked like. The commit is recorded because evidence that does
 * not name the build it came from cannot be re-checked later.
 */
export async function recordEvidence(testInfo: TestInfo, record: EvidenceRecord): Promise<void> {
  await testInfo.attach(`uat-evidence-${record.caseId}`, {
    contentType: "application/json",
    body: JSON.stringify(
      {
        ...record,
        run_marker: runMarker,
        recorded_at: new Date().toISOString(),
        tester: process.env.UAT_TESTER ?? "UNIDENTIFIED",
        frontend_commit: process.env.UAT_FRONTEND_COMMIT ?? "UNRECORDED",
        backend_commit: process.env.UAT_BACKEND_COMMIT ?? "UNRECORDED",
        target: { user_web: userWebUrl, admin_web: adminWebUrl, api: apiBaseUrl },
      },
      null,
      2,
    ),
  });
}

/** Read a JSON body and fail with the payload visible when the shape is wrong. */
export async function jsonOf(response: { json(): Promise<unknown>; text(): Promise<string> }) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`expected JSON, received: ${(await response.text()).slice(0, 300)}`);
  }
}
