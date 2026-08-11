import { flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type * as VueRouter from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push, createPayment } = vi.hoisted(() => ({
  push: vi.fn(),
  createPayment: vi.fn()
}));

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof VueRouter>();
  return {
    ...original,
    useRoute: () => ({ params: { locale: "zh-CN" } }),
    useRouter: () => ({ push })
  };
});

vi.mock("@/features/commerce/api", () => ({
  commerceApi: { createPayment }
}));

import ActivityPaymentPanel from "./ActivityPaymentPanel.vue";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    "zh-CN": {
      activities: {
        paymentRequired: "报名待支付",
        amountDue: "应付金额",
        paymentConfirmationBoundary: "验签后确认报名",
        creatingPayment: "正在创建支付…",
        payNow: "立即支付",
        paymentUnavailable: "没有可用支付方式",
        resumePayment: "继续完成支付"
      },
      commerce: { provider: "支付方式", error: "支付失败" }
    }
  }
});

const order = {
  id: "order-id",
  order_number: "ORD-1001",
  status: "pending_payment",
  currency: "USD",
  total_minor: 4900,
  refunded_total_minor: 0,
  available_payment_providers: ["stripe", "paypal"]
};

describe("ActivityPaymentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
  });

  it("creates a selected provider payment and opens the existing processing route", async () => {
    createPayment.mockResolvedValue({
      id: "payment-id",
      provider: "paypal",
      environment: "test",
      status: "created"
    });
    const wrapper = mount(ActivityPaymentPanel, {
      props: { order, registrationId: "registration-id" },
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } }
    });

    await wrapper.get("select").setValue("paypal");
    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(createPayment).toHaveBeenCalledWith(
      "ORD-1001",
      "paypal",
      "activity-payment-11111111-1111-4111-8111-111111111111"
    );
    expect(JSON.parse(sessionStorage.getItem("vav_payment_ORD-1001") ?? "null")).toMatchObject({
      id: "payment-id"
    });
    expect(push).toHaveBeenCalledWith({
      name: "checkout-processing",
      params: { locale: "zh-CN" },
      query: { order: "ORD-1001", registration: "registration-id" }
    });
  });

  it("fails closed when the server exposes no enabled payment provider", () => {
    const wrapper = mount(ActivityPaymentPanel, {
      props: { order: { ...order, available_payment_providers: [] } },
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } }
    });

    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("没有可用支付方式");
  });
});
