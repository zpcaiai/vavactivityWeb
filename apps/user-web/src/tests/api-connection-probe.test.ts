import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  explainApiConnectionError,
  healthProbeUrl,
  probeApiOnce,
  waitForApi
} from "@/config/api";
import { useAuthStore } from "@/stores/auth";
import { createPinia, setActivePinia } from "pinia";

const BASE = "https://api.example.com/api/v1";

/** What a browser actually throws when it refuses to hand over a response. */
function corsFailure() {
  return new TypeError("Failed to fetch");
}

/**
 * What a `mode: "no-cors"` request resolves to. The body is unreadable in a
 * browser; the code only cares that the promise settled, so any Response does.
 */
function opaqueResponse() {
  return new Response(null, { status: 200 });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("API reachability probe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("VITE_API_BASE_URL", BASE);
  });

  it("probes /health/live rather than the failing endpoint itself", () => {
    expect(healthProbeUrl(BASE)).toBe("https://api.example.com/api/v1/health/live");
    // A trailing slash on VITE_API_BASE_URL must not produce a double slash,
    // which some proxies 404 rather than normalise.
    expect(healthProbeUrl(`${BASE}/`)).toBe("https://api.example.com/api/v1/health/live");
  });

  it("reports `reachable` only when the health check is readable and ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { status: "ok" } })));
    await expect(probeApiOnce(BASE)).resolves.toBe("reachable");
  });

  it("reports `answered` for a readable non-2xx, which is the waking shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: {} }, 503)));
    await expect(probeApiOnce(BASE)).resolves.toBe("answered");
  });

  it("reports `answered` when CORS blocks the read but an opaque request succeeds", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(corsFailure())
      .mockResolvedValueOnce(opaqueResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeApiOnce(BASE)).resolves.toBe("answered");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ mode: "no-cors" });
  });

  it("reports `silent` only when nothing answers at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(corsFailure()));
    await expect(probeApiOnce(BASE)).resolves.toBe("silent");
  });

  it("keeps the best state seen, so one opaque hit outranks later silence", async () => {
    const fetchMock = vi.fn()
      // attempt 1: CORS-blocked, then opaque success -> answered
      .mockRejectedValueOnce(corsFailure())
      .mockResolvedValueOnce(opaqueResponse())
      // attempt 2: nothing at all -> silent
      .mockRejectedValueOnce(corsFailure())
      .mockRejectedValueOnce(corsFailure());
    vi.stubGlobal("fetch", fetchMock);

    // A budget below the second delay stops the loop after two attempts.
    await expect(waitForApi(BASE, { budgetMs: 1500 })).resolves.toBe("answered");
  });

  it("stops as soon as the API becomes readable", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(corsFailure())
      .mockResolvedValueOnce(opaqueResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { status: "ok" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(waitForApi(BASE, { budgetMs: 5000 })).resolves.toBe("reachable");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("connection error wording", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", BASE);
  });

  it("does not blame CORS when the API is demonstrably reachable", () => {
    const message = explainApiConnectionError("用户认证", BASE, "reachable");
    expect(message).not.toContain("CORS");
    expect(message).not.toContain("跨域");
    expect(message).toContain("可以正常访问");
  });

  it("names both waking and CORS when something answered but was unreadable", () => {
    const message = explainApiConnectionError("用户认证", BASE, "answered");
    expect(message).toContain("正在启动");
    expect(message).toContain("APP_CORS_ORIGINS");
  });

  it("blames neither when nothing answered", () => {
    const message = explainApiConnectionError("用户认证", BASE, "silent");
    expect(message).toContain("没有任何响应");
    expect(message).not.toContain("APP_CORS_ORIGINS");
  });
});

describe("auth store recovery", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    vi.stubEnv("VITE_API_BASE_URL", BASE);
    // The probe schedule spans ~43 real seconds by design, which is the point
    // of it — a sleeping instance needs that long. Fake timers let the test
    // assert the behaviour without waiting for it.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run `work` to completion while fast-forwarding every scheduled delay. */
  async function withoutWaiting<T>(work: Promise<T>): Promise<T> {
    const settled = work.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error })
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const outcome = await settled;
    if (outcome.ok) return outcome.value;
    throw outcome.error;
  }

  it("retries the request once after the API proves reachable", async () => {
    const fetchMock = vi.fn()
      // the real login attempt, killed mid-flight by a waking backend
      .mockRejectedValueOnce(corsFailure())
      // the health probe, now readable
      .mockResolvedValueOnce(jsonResponse({ data: { status: "ok" } }))
      // the retry
      .mockResolvedValueOnce(jsonResponse({ data: { message: "sent" } }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      withoutWaiting(useAuthStore().resendVerification("member@example.com"))
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[0][0]);
  });

  it("does not retry the request when the API never becomes readable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(corsFailure());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      withoutWaiting(useAuthStore().resendVerification("member@example.com"))
    ).rejects.toThrow(/没有任何响应/);
    // One real attempt plus probe pairs — but never a second attempt at the
    // mutation itself, which is the property worth protecting.
    const mutationCalls = fetchMock.mock.calls.filter(([url]) => !String(url).includes("/health/live"));
    expect(mutationCalls).toHaveLength(1);
  });
});
