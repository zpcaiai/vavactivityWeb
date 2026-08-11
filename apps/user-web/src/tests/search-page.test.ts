import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(async () => undefined),
  search: vi.fn(),
  auth: { user: null as null | { id: string } }
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    bootstrap: mocks.bootstrap,
    get user() {
      return mocks.auth.user;
    }
  })
}));

vi.mock("@/features/experience/api", () => ({
  experienceApi: { search: mocks.search }
}));

import SearchPage from "@/features/experience/pages/SearchPage.vue";

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
    mocks.bootstrap.mockClear();
    mocks.search.mockReset();
    mocks.search.mockResolvedValue([]);
  });

  it("starts with discovery content and does not search an empty query", async () => {
    const router = testRouter();
    await router.push("/zh-CN/search");
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.get("h1").text()).toBe("找到你需要的服务与下一步");
    expect(wrapper.text()).toContain("从常用入口开始");
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
    const wrapper = mount(SearchPage, { global: { plugins: [router] } });

    await wrapper.get('input[type="search"]').setValue("  活动  ");
    await wrapper.get('form[role="search"]').trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.query.q).toBe("活动");
    expect(mocks.bootstrap).toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalledWith("活动", false);
    expect(wrapper.get(".result-card").attributes("href")).toBe("/zh-CN/activities");
    expect(wrapper.text()).toContain("找到 1 个可见结果");
  });

  it("uses the authenticated endpoint decision after bootstrapping auth", async () => {
    mocks.bootstrap.mockImplementationOnce(async () => {
      mocks.auth.user = { id: "member" };
    });
    const router = testRouter();
    await router.push("/zh-CN/search?q=任务");
    await router.isReady();
    mount(SearchPage, { global: { plugins: [router] } });
    await flushPromises();

    expect(mocks.search).toHaveBeenCalledWith("任务", true);
  });

  it("distinguishes a completed empty search from the initial state", async () => {
    const router = testRouter();
    await router.push("/zh-CN/search?q=不存在");
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("没有找到“不存在”");
    expect(wrapper.text()).not.toContain("从常用入口开始");
  });
});
