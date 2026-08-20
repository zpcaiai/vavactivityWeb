import { expect, test } from "@playwright/test";

import {
  adminEmail,
  adminPassword,
  seedCounselingFixture,
  seedSuperAdmin
} from "./helpers";

test.beforeAll(() => {
  seedCounselingFixture();
  seedSuperAdmin();
});

test("an authorized operator can use the counseling operations center", async ({ page }) => {
  await page.goto("http://localhost:5174/admin/login");
  await page.getByLabel("管理员邮箱").fill(adminEmail);
  await page.getByLabel("密码").fill(adminPassword);
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto("http://localhost:5174/admin/counseling");
  await expect(page.getByRole("heading", { name: "辅导中心", level: 2 })).toBeVisible();
  await expect(page.getByText("录音与转写默认关闭")).toBeVisible();
  await page.getByRole("tab", { name: "导师与服务", exact: true }).click();
  await expect(page.getByText("counseling-e2e-mentor")).toBeVisible();
  await expect(page.getByText("counseling-e2e-growth-session")).toBeVisible();
});
