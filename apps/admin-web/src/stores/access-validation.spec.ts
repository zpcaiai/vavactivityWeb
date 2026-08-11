import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAccessStore } from "./access";

describe("admin login validation", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects the former admin placeholder before sending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(useAccessStore().login("admin", "admin")).rejects.toThrow(
      "请输入有效的超级管理员邮箱"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the backend email validation detail instead of Invalid request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: [{
          location: ["body", "email"],
          message: "value is not a valid email address",
          type: "value_error"
        }]
      }
    }), {
      status: 422,
      headers: { "Content-Type": "application/json" }
    })));

    await expect(
      useAccessStore().login("admin@example.com", "admin")
    ).rejects.toThrow("邮箱：请输入有效的邮箱地址");
  });
});
