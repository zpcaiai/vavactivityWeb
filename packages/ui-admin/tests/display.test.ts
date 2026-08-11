import { describe, expect, it } from "vitest";

import { formatAdminDate, localizeAdminLabel, localizeAdminValue } from "../src/display";

describe("admin Chinese display", () => {
  it("formats timestamps in UTC+8", () => {
    expect(formatAdminDate("2026-08-11T08:28:23.720Z")).toBe("2026-08-11 16:28:23（UTC+8）");
  });

  it("adds the timezone to date headers", () => {
    expect(localizeAdminLabel("updated_at", "更新时间")).toBe("更新时间（UTC+8）");
    expect(localizeAdminLabel("trigger_at")).toBe("触发时间（UTC+8）");
    expect(localizeAdminLabel("unmapped_field", "Unmapped Field")).toBe("字段（Unmapped Field）");
  });

  it("localizes common enum and locale values", () => {
    expect(localizeAdminValue("active", "status")).toBe("启用");
    expect(localizeAdminValue("course_bundle", "product_type")).toBe("课程组合");
    expect(localizeAdminValue("zh-CN", "default_locale")).toBe("简体中文");
    expect(localizeAdminValue(true, "featured")).toBe("是");
  });

  it("renders record content with Chinese field labels", () => {
    expect(localizeAdminValue({ status: "pending", updated_at: "2026-08-11T00:00:00Z" })).toContain("状态：待处理");
    expect(localizeAdminValue({ status: "pending", updated_at: "2026-08-11T00:00:00Z" })).toContain("更新时间（UTC+8）：2026-08-11 08:00:00（UTC+8）");
  });
});
