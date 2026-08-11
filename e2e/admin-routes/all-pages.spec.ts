import { expect, test, type Page, type Response } from "@playwright/test";

import {
  adminEmail,
  adminPassword,
  resetLoginRateLimits,
  seedSuperAdmin
} from "../helpers";

const adminBaseUrl = process.env.E2E_ADMIN_WEB_URL ?? "http://localhost:5174";

const families: Record<string, string[]> = {
  notifications: [
    "dashboard", "templates", "template-releases", "event-subscriptions", "deliveries",
    "dead-letters", "reminders", "campaigns", "providers", "provider-events",
    "suppressions", "unsubscribes", "audit"
  ],
  matchmaking: [
    "profiles", "reviews", "photo-reviews", "schema-releases", "taxonomies", "projections", "audit"
  ],
  recommendations: [
    "dashboard", "strategies", "features", "constraints", "batches", "candidates",
    "diagnostics", "pair-diagnostics", "exposures", "cold-start", "feedback", "evaluations",
    "experiments", "incidents", "audit"
  ],
  "matchmaking-interactions": [
    "dashboard", "pairs", "matches", "invitations", "contact-exchanges", "invalidations",
    "dead-letters", "incidents", "audit"
  ],
  relationships: [
    "dashboard", "journeys", "stages", "proposals", "pauses", "endings", "milestones",
    "checkins", "reminders", "audit"
  ],
  memberships: [
    "dashboard", "plans", "plan-versions", "benefits", "sku-mappings", "accounts", "cycles",
    "changes", "quotas", "usage", "adjustments", "manual-grants", "trials", "reconciliation",
    "incidents", "audit"
  ],
  "trust-safety": [
    "reports", "cases", "moderation", "harassment", "fraud", "restrictions", "appeals",
    "rules", "red-team", "audit"
  ],
  system: [
    "status", "releases", "jobs", "integrations", "dead-letters", "feature-flags",
    "maintenance", "backups", "restore-drills", "capacity"
  ],
  skills: [
    "dashboard", "catalog", "installations", "executions", "dependencies", "permissions",
    "configurations", "publishers", "reviews", "marketplace", "incidents", "audit"
  ],
  quality: [
    "dashboard", "requirements", "capabilities", "traceability", "business-flows", "gaps",
    "risks", "waivers", "evidence", "gates", "gate-runs", "releases", "certifications", "audit"
  ],
  "design-system": [
    "dashboard", "tokens", "components", "patterns", "pages", "accessibility",
    "responsive-audits", "visual-regression", "baselines", "evidence", "releases", "audit"
  ],
  experience: [
    "dashboard", "ia", "routes", "navigation", "tasks", "journeys", "handoffs",
    "search-governance", "help", "support", "dead-ends", "analytics", "evidence", "release", "audit"
  ],
  processes: [
    "dashboard", "definitions", "state-machines", "instances", "sagas", "timeouts",
    "cancellations", "compensations", "stuck", "interventions", "simulations",
    "certifications", "release"
  ],
  "data-governance": [
    "dashboard", "assets", "contracts", "lineage", "events", "event-gaps", "dead-letters",
    "quality", "reconciliations", "differences", "backfills", "repairs", "projections",
    "erasures", "certifications", "release"
  ],
  platform: [
    "dashboard", "capabilities", "work-items", "saved-views", "bulk-jobs", "approvals",
    "exceptions", "configurations", "field-access", "reveal-history", "certifications",
    "releases", "audit"
  ],
  privacy: [
    "dashboard", "requests", "exports", "corrections", "erasures", "consents",
    "consent-releases", "inventory", "processing", "classifications", "retention",
    "retention-instances", "holds", "break-glass", "access-events", "incidents", "audit"
  ]
};

const standaloneRoutes = [
  "/admin/dashboard",
  "/admin/content/pages",
  "/admin/content/articles",
  "/admin/content/testimonials",
  "/admin/content/media",
  "/admin/content/navigation",
  "/admin/content/settings",
  "/admin/contact-submissions",
  "/admin/catalog/products",
  "/admin/catalog/price-books",
  "/admin/catalog/prices",
  "/admin/catalog/inventory",
  "/admin/catalog/promotions",
  "/admin/catalog/coupons",
  "/admin/catalog/pricing/simulate",
  "/admin/commerce/orders",
  "/admin/commerce/payments",
  "/admin/commerce/subscriptions",
  "/admin/commerce/refunds",
  "/admin/commerce/webhooks",
  "/admin/commerce/reconciliation",
  "/admin/commerce/entitlements",
  "/admin/users",
  "/admin/activities",
  "/admin/courses",
  "/admin/counseling",
  "/admin/knowledge",
  "/admin/ai",
  "/admin/access/admins",
  "/admin/access/roles",
  "/admin/access/permissions",
  "/admin/access/invitations",
  "/admin/audit/auth",
  "/admin/audit/permissions"
];

export const governedAdminRoutes = [
  ...standaloneRoutes,
  ...Object.entries(families).flatMap(([family, sections]) =>
    sections.map((section) => `/admin/${family}/${section}`)
  )
];

test.beforeAll(() => {
  resetLoginRateLimits();
  seedSuperAdmin();
});

async function signIn(page: Page) {
  await page.goto(`${adminBaseUrl}/admin/login`);
  await page.getByLabel("管理员邮箱").fill(adminEmail);
  await page.getByLabel("密码").fill(adminPassword);
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/u);
}

test("every governed static admin page renders without API or runtime failures", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await signIn(page);
  const routeFailures: string[] = [];

  for (const route of governedAdminRoutes) {
    await test.step(route, async () => {
      const apiFailures: string[] = [];
      const runtimeFailures: string[] = [];
      const onResponse = (response: Response) => {
        const url = response.url();
        if (url.includes("/api/") && response.status() >= 400) {
          apiFailures.push(`${response.status()} ${response.request().method()} ${url}`);
        }
      };
      const onPageError = (error: Error) => runtimeFailures.push(error.message);
      page.on("response", onResponse);
      page.on("pageerror", onPageError);
      try {
        await page.evaluate((nextRoute) => {
          window.history.pushState({}, "", nextRoute);
          window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
        }, route);
        await page.waitForURL(`${adminBaseUrl}${route}`);
        await page.waitForTimeout(200);
        if (/\/admin\/(?:login|403|404|500)(?:$|\?)/u.test(page.url())) {
          routeFailures.push(`${route}: redirected to ${page.url()}`);
        }
        try {
          await page.locator("main").waitFor({ state: "visible", timeout: 2_000 });
        } catch {
          routeFailures.push(`${route}: main content is not visible`);
        }
        const dimensions = await page.evaluate(() => ({
          contentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth
        }));
        if (dimensions.contentWidth > dimensions.viewportWidth + 1) {
          routeFailures.push(
            `${route}: horizontal overflow ${dimensions.contentWidth - dimensions.viewportWidth}px`
          );
        }
        if (await page.locator("vite-error-overlay").count()) {
          routeFailures.push(`${route}: Vite error overlay is present`);
        }
        routeFailures.push(...runtimeFailures.map((failure) => `${route}: runtime ${failure}`));
        routeFailures.push(...apiFailures.map((failure) => `${route}: API ${failure}`));
      } catch (cause) {
        routeFailures.push(`${route}: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        page.off("response", onResponse);
        page.off("pageerror", onPageError);
      }
    });
  }

  expect(routeFailures).toEqual([]);
});
