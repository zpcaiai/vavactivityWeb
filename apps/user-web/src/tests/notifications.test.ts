import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ bootstrap: vi.fn(), accessToken: "token" }));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => auth }));

import { notificationApi, type NotificationPreference } from "@/features/notifications/api";

describe("notification preferences client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    auth.bootstrap.mockResolvedValue(undefined);
  });

  it("does not send read-only response metadata when saving preferences", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { updated: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const preference = {
      category: "activity",
      channel: "email",
      enabled: true,
      frequency: "daily_digest",
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_timezone: "Asia/Shanghai",
      version: 2,
      updated_at: "2026-08-11T00:00:00Z"
    } as NotificationPreference;

    await notificationApi.updatePreferences([preference]);

    const [, init] = request.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      items: [
        {
          category: "activity",
          channel: "email",
          enabled: true,
          frequency: "daily_digest",
          quiet_hours_enabled: false,
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_timezone: "Asia/Shanghai"
        }
      ]
    });
  });
});
