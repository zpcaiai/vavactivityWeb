import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SkuSelector from "./SkuSelector.vue";
import type { CatalogSku } from "../types";

function sku(overrides: Partial<CatalogSku> = {}): CatalogSku {
  return {
    id: "sku-1",
    sku_code: "COURSE_SHOWCASE_COMMUNICATION_ACCESS",
    billing_type: "free",
    service_quantity: null,
    service_unit: null,
    entitlement_definition: {},
    purchase_limit_per_user: 1,
    prices: [],
    availability: {
      status: "available",
      inventory_policy: "unlimited",
      available_quantity: null
    },
    ...overrides
  };
}

describe("SkuSelector", () => {
  it("replaces technical course SKU codes with concise Chinese copy", () => {
    const wrapper = mount(SkuSelector, {
      props: {
        modelValue: "sku-1",
        productType: "course",
        skus: [sku()]
      }
    });

    expect(wrapper.text()).toContain("课程学习");
    expect(wrapper.text()).not.toContain("COURSE_SHOWCASE_COMMUNICATION_ACCESS");
  });

  it("prefers a configured Chinese name and localizes the service unit", () => {
    const wrapper = mount(SkuSelector, {
      props: {
        modelValue: "sku-1",
        skus: [
          sku({
            service_quantity: 3,
            service_unit: "session",
            entitlement_definition: { display_name_zh: "三次成长辅导" }
          })
        ]
      }
    });

    expect(wrapper.text()).toContain("三次成长辅导");
    expect(wrapper.text()).toContain("3 次服务");
  });
});
