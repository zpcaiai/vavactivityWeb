import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  auth: { user: null as null | { id: string } }
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    get user() {
      return mocks.auth.user;
    }
  })
}));

vi.mock("@/features/experience/api", () => ({
  experienceApi: { search: mocks.search }
}));

import SearchPage from "@/features/experience/pages/SearchPage.vue";
import { i18n } from "@/i18n";

function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/:locale/search", component: SearchPage },
      { path: "/:locale/:pathMatch(.*)*", component: { template: "<p>destination</p>" } }
    ]
  });
}

describe("SearchPage", () => {
  beforeEach(() => {
    mocks.auth.user = null;
    mocks.search.mockReset();
    mocks.search.mockResolvedValue([]);
  });

  it("starts with discovery content and does not search an empty query", async () => {
    const router = testRouter();
    await router.push("/zh-CN/search");
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [router, i18n] } });
    await flushPromises();

    expect(wrapper.get("h1").text()).toBe("全站搜索");
    expect(wrapper.text()).toContain("结果按权限过滤");
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("writes the query to the URL and renders route_code results as destination links", async () => {
    mocks.search.mockResolvedValue([
      {
        document_code: "public.activities",
        source_module: "activities",
        title: "活动",
        summary: "查看可报名活动",
        route_code: "user.activities"
      }
    ]);
    const router = testRouter();
    await router.push("/zh-CN/search");
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [router, i18n] } });

    await wrapper.get('input[type="search"]').setValue("  活动  ");
    await wrapper.get('form[role="search"]').trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.query.q).toBe("活动");
    expect(mocks.search).toHaveBeenCalledWith("活动", false);
    expect(wrapper.get(".search-results a").attributes("href")).toBe("/zh-CN/activities");
    expect(wrapper.text()).toContain("查看可报名活动");
  });

  it("uses the authenticated endpoint decision for a signed-in member", async () => {
    mocks.auth.user = { id: "member" };
    const router = testRouter();
    await router.push("/zh-CN/search?q=任务");
    await router.isReady();
    mount(SearchPage, { global: { plugins: [router, i18n] } });
    await flushPromises();

    expect(mocks.search).toHaveBeenCalledWith("任务", true);
  });

  it("distinguishes a completed empty search from the initial state", async () => {
    const router = testRouter();
    await router.push("/zh-CN/search?q=不存在");
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [router, i18n] } });
    await flushPromises();

    expect(mocks.search).toHaveBeenCalledWith("不存在", false);
    expect(wrapper.text()).toContain("没有匹配结果");
  });
});
