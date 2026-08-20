import { expect, test } from "@playwright/test";

test("public plans explain enforceable benefits and limits", async ({ page }) => {
  await page.goto("/zh-CN/membership/plans");
  await expect(page.getByRole("heading", { name: "会员方案" })).toBeVisible();
  await expect(page.getByText(/不能绕过安全、隐私与对方的选择/)).toBeVisible();
  await expect(page.getByText(/无限 AI|无限推荐|永久课程/)).toHaveCount(0);
});
