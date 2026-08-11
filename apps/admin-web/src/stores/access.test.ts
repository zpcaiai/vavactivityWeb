import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAccessStore } from "./access";

describe("admin access bootstrap", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.cookie = "vav_admin_csrf=csrf-test; path=/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares an in-flight refresh across concurrent page bootstraps", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await refreshGate;
      return new Response(JSON.stringify({
        data: {
          access_token: "admin-access-token",
          expires_in: 900,
          user: {
            id: "admin-1",
            email: "admin@example.com",
            status: "active",
            email_verified: true,
            permissions: ["users.read"]
          }
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const access = useAccessStore();
    const routerBootstrap = access.bootstrap();
    const pageBootstrap = access.bootstrap();
    let pageReady = false;
    void pageBootstrap.then(() => {
      pageReady = true;
    });

    await Promise.resolve();
    expect(pageReady).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseRefresh();
    await Promise.all([routerBootstrap, pageBootstrap]);

    expect(access.accessToken).toBe("admin-access-token");
    expect(access.isAuthenticated).toBe(true);
  });

  it("refreshes once and retries a protected request after a 401", async () => {
    const protectedTokens: string[] = [];
    let protectedAttempts = 0;
    const authPayload = (token: string) => JSON.stringify({
      data: {
        access_token: token,
        expires_in: 900,
        user: {
          id: "admin-1",
          email: "admin@example.com",
          status: "active",
          email_verified: true,
          permissions: ["users.read"]
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/admin/auth/login")) {
        return new Response(authPayload("expired-token"), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/admin/auth/refresh")) {
        return new Response(authPayload("renewed-token"), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      protectedAttempts += 1;
      protectedTokens.push(new Headers(init?.headers).get("Authorization") ?? "");
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: protectedAttempts === 1 ? 401 : 200,
        headers: { "Content-Type": "application/json" }
      });
    }));

    const access = useAccessStore();
    await access.login("admin@example.com", "valid password");
    const response = await access.authorizedFetch("/api/v1/admin/users");

    expect(response.status).toBe(200);
    expect(protectedTokens).toEqual(["Bearer expired-token", "Bearer renewed-token"]);
  });
});
