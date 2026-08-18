import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { localizeAdminLabel } from "../src/display";

/**
 * Eight of the eleven admin pages build their columns from `Object.keys(row)`
 * at runtime, so any API field the dictionary does not know renders as a raw
 * header — that is how the orders table came to show 字段（order_number）.
 *
 * The fixture is generated from the backend's response schemas *and* its ORM
 * models. Both are needed: the orders endpoint returns row mappings, so
 * `order_number` and the `*_total_minor` columns exist only on the model.
 * Regenerate with tests/fixtures-api-fields.README.md when the API changes.
 */
// Vitest rewrites import.meta.url to a non-file scheme, so the path is
// resolved rather than handed to readFileSync as a URL.
const here = dirname(fileURLToPath(new URL(import.meta.url)));
const fields = readFileSync(join(here, "fixtures-api-fields.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

describe("admin column headers", () => {
  it("has a fixture covering the whole API surface", () => {
    expect(fields.length).toBeGreaterThan(1700);
  });

  it("never renders a raw field name as a column header", () => {
    // Two distinct escapes. The placeholder is the obvious one; the date branch
    // is the subtle one, because it echoes the field name instead and so slips
    // past a check that only looks for 字段（…）.
    const leaked = fields
      .map((field) => [field, localizeAdminLabel(field)] as const)
      .filter(([field, label]) => label.startsWith("字段（") || label.includes(field));
    expect(leaked).toEqual([]);
  });

  it("labels the order table the way the console should read it", () => {
    // The exact columns from the reported screenshot.
    expect(localizeAdminLabel("order_number")).toBe("订单编号");
    expect(localizeAdminLabel("currency")).toBe("币种");
    expect(localizeAdminLabel("subtotal_minor")).toBe("小计（最小货币单位）");
    expect(localizeAdminLabel("discount_total_minor")).toBe("折扣总计（最小货币单位）");
    expect(localizeAdminLabel("tax_total_minor")).toBe("税总计（最小货币单位）");
    expect(localizeAdminLabel("total_minor")).toBe("总计（最小货币单位）");
  });

  it("puts units in parentheses instead of concatenating them", () => {
    expect(localizeAdminLabel("edit_window_hours")).toBe("可编辑窗口（小时）");
    expect(localizeAdminLabel("access_duration_days")).toBe("访问时长（天）");
    expect(localizeAdminLabel("duration_seconds")).toBe("时长（秒）");
    expect(localizeAdminLabel("progress_basis_points")).toBe("进度（基点）");
  });

  it("reorders around English prepositions rather than concatenating", () => {
    expect(localizeAdminLabel("allow_profile_use_by_ai")).toBe("允许 AI 使用档案");
    expect(localizeAdminLabel("date_of_birth")).toBe("出生日期");
    expect(localizeAdminLabel("allow_edit_after_submit")).toBe("允许提交后编辑");
  });

  it("derives actor and boolean columns by rule, not by dictionary row", () => {
    // These must keep working for fields that do not exist yet.
    expect(localizeAdminLabel("created_by")).toBe("创建人");
    expect(localizeAdminLabel("approved_by")).toBe("批准人");
    expect(localizeAdminLabel("is_active")).toBe("是否启用");
    expect(localizeAdminLabel("is_published")).toBe("是否发布");
    // …but a mid-name `by` is not an actor.
    expect(localizeAdminLabel("replaced_by_certificate_id")).toBe("替换为证书编号");
  });

  it("keeps the timezone marker on every date column", () => {
    for (const field of ["created_at", "paid_at", "post_event_choice_opens_at"]) {
      expect(localizeAdminLabel(field)).toContain("（UTC+8）");
    }
  });

  it("prefers the caller's Chinese fallback over guessing", () => {
    expect(localizeAdminLabel("some_unmapped_thing", "自定义列名")).toBe("自定义列名");
  });
});
