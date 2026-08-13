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

  it("protects implemented detail routes with their read permissions", () => {
    const expected = new Map([
      ["/admin/catalog/skus/example", ["admin-catalog-sku-edit", "catalog.skus.read"]],
      [
        "/admin/catalog/inventory/example",
        ["admin-catalog-inventory-detail", "catalog.inventory.read"]
      ],
      [
        "/admin/catalog/promotions/example",
        ["admin-catalog-promotion-edit", "catalog.promotions.read"]
      ],
      [
        "/admin/notifications/templates/example",
        ["admin-notifications-template-detail", "notifications.templates.read"]
      ],
      [
        "/admin/notifications/deliveries/example",
        ["admin-notifications-delivery-detail", "notifications.deliveries.read"]
      ],
      [
        "/admin/notifications/campaigns/example",
        ["admin-notifications-campaign-detail", "notifications.campaigns.read"]
      ],
      [
        "/admin/matchmaking/profiles/example",
        ["admin-matchmaking-profile-detail", "matchmaking.profiles.read"]
      ],
      [
        "/admin/matchmaking/reviews/example",
        ["admin-matchmaking-review-detail", "matchmaking.reviews.read"]
      ],
      [
        "/admin/privacy/requests/example",
        ["admin-privacy-request-detail", "privacy.requests.read"]
      ]
    ]);

    for (const [path, [name, permission]] of expected) {
      const route = router.resolve(path);
      expect(route.name, path).toBe(name);
      expect(route.meta.permission, path).toBe(permission);
    }
  });
});
