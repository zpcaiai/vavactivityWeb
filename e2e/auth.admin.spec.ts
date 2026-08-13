import { expect, test } from "@playwright/test";

import { adminEmail, adminPassword, seedSuperAdmin } from "./helpers";

const adminWebUrl = (process.env.E2E_ADMIN_WEB_URL ?? "http://localhost:5174").replace(/\/$/u, "");

test.beforeAll(() => {
  seedSuperAdmin();
});

test("an administrator signs in and reaches permission-protected operations", async ({
  page
}) => {
  await page.goto(`${adminWebUrl}/admin/login`);
  await page.getByLabel("管理员邮箱").fill(adminEmail);
  await page.getByLabel("密码").fill(adminPassword);
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/admin/auth/login"),
    { timeout: 60_000 }
  );
  await page.getByRole("button", { name: "安全登录" }).click();
  expect((await loginResponse).ok()).toBe(true);

  await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  await page.getByPlaceholder("筛选模块").fill("管理员");
  await page.getByRole("link", { name: "管理员", exact: true }).click();
  await page.getByRole("link", { name: "角色", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/access\/roles$/);
  await expect(page.getByRole("heading", { name: "角色权限" })).toBeVisible();

  await page.getByTestId("admin-locale-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: "Operations workspace", exact: true })).toBeVisible();
});
