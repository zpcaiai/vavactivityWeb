import { describe, expect, it } from "vitest";

import { router } from "./index";

describe("admin routes", () => {
  it("protects every operational page with authentication and permission metadata", () => {
    const publicNames = new Set(["admin-login", "admin-accept-invitation"]);
    const operationalRoutes = router.getRoutes().filter((route) =>
      route.path.startsWith("/admin/") &&
      route.components &&
      !publicNames.has(String(route.name)) &&
      !["admin-dashboard", "admin-forbidden", "admin-error", "admin-not-found"].includes(String(route.name))
    );

    expect(operationalRoutes.length).toBeGreaterThan(150);
    for (const route of operationalRoutes) {
      expect(route.meta.permission, route.path).toEqual(expect.any(String));
    }
  });

  it("redirects legacy module foundations to operational admin pages", () => {
    const expectedRedirects = new Map([
      ["/admin/content", "/admin/content/pages"],
      ["/admin/orders", "/admin/commerce/orders"],
      ["/admin/payments", "/admin/commerce/payments"],
      ["/admin/moderation", "/admin/trust-safety/moderation"],
      ["/admin/settings", "/admin/content/settings"],
      ["/admin/audit", "/admin/audit/auth"]
    ]);

    for (const [path, redirect] of expectedRedirects) {
      expect(router.resolve(path).redirectedFrom).toBeUndefined();
      const record = router.getRoutes().find((route) => route.path === path);
      expect(record?.redirect).toBe(redirect);
      expect(record?.components).toBeUndefined();
    }
  });

  it("does not advertise detail routes that have no detail view", () => {
    for (const path of [
      "/admin/catalog/skus/example",
      "/admin/catalog/inventory/example",
      "/admin/catalog/promotions/example",
      "/admin/notifications/templates/example",
      "/admin/notifications/deliveries/example",
      "/admin/notifications/campaigns/example",
      "/admin/matchmaking/profiles/example",
      "/admin/matchmaking/reviews/example",
      "/admin/privacy/requests/example"
    ]) {
      expect(router.resolve(path).name, path).toBe("admin-not-found");
    }
  });
});
