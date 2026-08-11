import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";

const user = {
  id: "user-1",
  email: "member@example.com",
  status: "active",
  email_verified: true,
  preferred_locale: "zh-CN",
  timezone: "Asia/Shanghai",
  permissions: []
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("auth store registration and logout", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("returns the registration result and can resend verification email", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          registration_status: "verification_required",
          email: "m***@example.com"
        }
      }, 202))
      .mockResolvedValueOnce(jsonResponse({ data: { message: "sent" } }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const auth = useAuthStore();

    await expect(auth.register({
      email: "member@example.com",
      password: "correct horse battery staple",
      preferred_locale: "zh-CN",
      timezone: "Asia/Shanghai",
      terms_version: "2026-07-01",
      privacy_version: "2026-07-01"
    })).resolves.toEqual({
      registration_status: "verification_required",
      email: "m***@example.com"
    });
    await expect(auth.resendVerification(" member@example.com ")).resolves.toBe("sent");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/register",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/email-verification/send",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "member@example.com" })
      })
    );
  });

  it("sends the authenticated logout request and clears the local session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { access_token: "member-token", expires_in: 900, user }
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { logged_out: true } }));
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "vav_user_csrf=csrf-token; path=/";
    const auth = useAuthStore();

    await auth.login("member@example.com", "correct horse battery staple");
    await auth.logout();

    const logoutInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = new Headers(logoutInit.headers);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/logout");
    expect(headers.get("Authorization")).toBe("Bearer member-token");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token");
    expect(auth.user).toBeNull();
    expect(auth.status).toBe("anonymous");
  });
});
