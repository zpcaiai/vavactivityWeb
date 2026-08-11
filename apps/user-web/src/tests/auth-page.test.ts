import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  resendVerification: vi.fn()
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => mocks
}));

import { i18n } from "@/i18n";
import AuthPage from "@/pages/AuthPage.vue";

function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/:locale/auth/register", component: AuthPage, props: { mode: "register" } },
      { path: "/:locale/auth/login", component: AuthPage, props: { mode: "login" } },
      { path: "/:locale/account", component: { template: "<p>account</p>" } }
    ]
  });
}

describe("AuthPage registration", () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.register.mockReset();
    mocks.resendVerification.mockReset();
    mocks.register.mockResolvedValue({
      registration_status: "verification_required",
      email: "m***@example.com"
    });
    mocks.resendVerification.mockResolvedValue("sent");
  });

  it("confirms account creation and offers verification email resend", async () => {
    const router = testRouter();
    await router.push("/zh-CN/auth/register");
    await router.isReady();
    const wrapper = mount(AuthPage, {
      props: { mode: "register" },
      global: { plugins: [router, i18n] }
    });

    await wrapper.get('input[type="email"]').setValue("member@example.com");
    await wrapper.get('input[type="password"]').setValue("correct horse battery staple");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      email: "member@example.com",
      preferred_locale: "zh-CN"
    }));
    expect(wrapper.text()).toContain("注册成功，请验证邮箱");
    expect(wrapper.text()).toContain("m***@example.com");

    await wrapper.get("button.secondary-button").trigger("click");
    await flushPromises();

    expect(mocks.resendVerification).toHaveBeenCalledWith("member@example.com");
    expect(wrapper.text()).toContain("验证邮件已重新发送");
    expect(wrapper.get("a.primary-button").attributes("href"))
      .toContain("/zh-CN/auth/login?email=member@example.com");
  });

  it("allows direct login when staging registration does not require verification", async () => {
    mocks.register.mockResolvedValueOnce({
      registration_status: "active",
      email: "m***@example.com"
    });
    const router = testRouter();
    await router.push("/zh-CN/auth/register");
    await router.isReady();
    const wrapper = mount(AuthPage, {
      props: { mode: "register" },
      global: { plugins: [router, i18n] }
    });

    await wrapper.get('input[type="email"]').setValue("member@example.com");
    await wrapper.get('input[type="password"]').setValue("correct horse battery staple");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("注册成功，可以登录");
    expect(wrapper.text()).toContain("当前环境无需邮箱验证码");
    expect(wrapper.find("button.secondary-button").exists()).toBe(false);
    expect(wrapper.get("a.primary-button").attributes("href"))
      .toContain("/zh-CN/auth/login?email=member@example.com");
  });
});
