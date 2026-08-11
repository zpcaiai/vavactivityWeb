import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  clearSession: vi.fn(),
  getNavigation: vi.fn()
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    user: { id: "user-1", email: "member@example.com" },
    logout: mocks.logout,
    clearSession: mocks.clearSession
  })
}));

vi.mock("@/features/public-site/api/content", () => ({
  getNavigation: mocks.getNavigation
}));

import { i18n } from "@/i18n";
import PublicLayout from "@/layouts/PublicLayout.vue";

describe("PublicLayout authenticated navigation", () => {
  beforeEach(() => {
    mocks.logout.mockReset();
    mocks.clearSession.mockReset();
    mocks.getNavigation.mockReset();
    mocks.logout.mockResolvedValue(undefined);
    mocks.getNavigation.mockResolvedValue([]);
  });

  it("shows logout after login and returns to the locale home", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<p>language</p>" } },
        {
          path: "/:locale/:pathMatch(.*)*",
          component: PublicLayout,
          children: [{ path: "", component: { template: "<h1>home</h1>" } }]
        }
      ]
    });
    await router.push("/zh-CN/account");
    await router.isReady();
    const wrapper = mount(PublicLayout, {
      global: {
        plugins: [router, i18n],
        stubs: {
          VSkipLink: true,
          NotificationBell: true,
          GlobalCommandPalette: true,
          RouterView: true
        }
      }
    });
    await flushPromises();

    const logout = wrapper.get("button.logout-link");
    expect(logout.text()).toBe("安全退出");
    await logout.trigger("click");
    await flushPromises();

    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe("/zh-CN/");
  });
});
