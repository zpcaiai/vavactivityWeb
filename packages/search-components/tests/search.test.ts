import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { PermissionAwareSearchBox, SearchBox } from "../src";

describe("SearchBox", () => {
  it("keeps the compatibility export and emits a trimmed query", async () => {
    expect(SearchBox).toBe(PermissionAwareSearchBox);
    const wrapper = mount(SearchBox);
    await wrapper.get("input").setValue("  活动  ");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("search")?.[0]).toEqual(["活动"]);
  });

  it("exposes a labelled search field and clears it accessibly", async () => {
    const wrapper = mount(SearchBox, {
      props: {
        inputId: "catalog-search",
        label: "搜索活动与课程",
        modelValue: "课程"
      }
    });

    expect(wrapper.get("label").attributes("for")).toBe("catalog-search");
    expect(wrapper.get("input").attributes("type")).toBe("search");
    await wrapper.get('[aria-label="清除搜索关键词"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
    expect(wrapper.emitted("clear")).toHaveLength(1);
  });

  it("announces its busy state and prevents duplicate submission", async () => {
    const wrapper = mount(SearchBox, { props: { modelValue: "辅导", busy: true } });
    expect(wrapper.get("form").attributes("aria-busy")).toBe("true");
    expect(wrapper.get('.vav-search-box__submit').text()).toContain("搜索中");
    expect(wrapper.get('.vav-search-box__submit').attributes()).toHaveProperty("disabled");
  });
});
