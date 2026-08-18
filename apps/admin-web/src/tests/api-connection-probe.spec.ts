import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { explainApiConnectionError, probeApiOnce } from "@/config/api";
import { useAccessStore } from "@/stores/access";

const BASE = "https://api.example.com/api/v1";

function corsFailure() {
  return new TypeError("Failed to fetch");
}

function opaqueResponse() {
  return new Response(null, { status: 200 });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("admin API reachability probe", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    vi.stubEnv("VITE_API_BASE_URL", BASE);
  });

  it("separates an unreadable-but-answering backend from a silent one", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(corsFailure())
      .mockResolvedValueOnce(opaqueResponse()));
    await expect(probeApiOnce(BASE)).resolves.toBe("answered");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(corsFailure()));
    await expect(probeApiOnce(BASE)).resolves.toBe("silent");
  });

  it("never accuses CORS when the admin API is reachable", () => {
    const message = explainApiConnectionError("管理员认证", BASE, "reachable");
    expect(message).toContain("管理员认证");
    expect(message).not.toContain("跨域");
    expect(message).not.toContain("APP_CORS_ORIGINS");
  });

  describe("login recovery", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries the login once after the API proves reachable", async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(corsFailure())
        .mockResolvedValueOnce(jsonResponse({ data: { status: "ok" } }))
        .mockResolvedValueOnce(jsonResponse({
          data: {
            access_token: "token",
            admin: { id: "admin-1", email: "admin@example.com", roles: [], permissions: [] }
          }
        }));
      vi.stubGlobal("fetch", fetchMock);

      const pending = useAccessStore()
        .login("admin@example.com", "correct horse battery staple")
        .then(() => "ok", (error: Error) => error);
      await vi.advanceTimersByTimeAsync(60_000);
      await pending;

      const loginCalls = fetchMock.mock.calls
        .filter(([url]) => String(url).includes("/admin/auth/login"));
      expect(loginCalls).toHaveLength(2);
    });
  });
});
