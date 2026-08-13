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

  it("shows the authenticated member-space destination", async () => {
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

    const memberSpace = wrapper.get(".site-header__cta");
    expect(memberSpace.text()).toContain("会员空间");
    expect(memberSpace.attributes("href")).toBe("/zh-CN/account/home");
  });

  it("renders content-managed navigation at its configured route", async () => {
    mocks.getNavigation.mockResolvedValueOnce([
      {
        id: "navigation-about",
        label: "关于 VAV",
        link_type: "route",
        external_url: null,
        route_name: "about",
        target_slug: null,
        open_in_new_tab: false,
        required_auth: false
      }
    ]);
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
    await router.push("/zh-CN/");
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

    const aboutLink = wrapper
      .findAll("a")
      .find((link) => link.text() === "关于 VAV");
    expect(aboutLink?.attributes("href")).toBe("/zh-CN/about");
    expect(wrapper.get(".site-nav").text()).toContain("关于 VAV");
  });
});
