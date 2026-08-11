import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { adminEmail, adminPassword, resetLoginRateLimits, seedSuperAdmin } from "../helpers";

const adminBaseUrl = process.env.E2E_ADMIN_WEB_URL ?? "http://localhost:5174";

test.beforeAll(() => {
  resetLoginRateLimits();
  execFileSync("docker", ["compose", "exec", "-T", "api", "python", "-m", "vav.cli.seed_permissions"], {
    stdio: "pipe"
  });
  execFileSync("docker", ["compose", "exec", "-T", "api", "python", "-m", "vav.cli.seed_process_governance"], {
    stdio: "pipe"
  });
  seedSuperAdmin();
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${adminBaseUrl}/admin/login`);
  await page.getByLabel("管理员邮箱").fill(adminEmail);
  await page.getByLabel("密码").fill(adminPassword);
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/u);
}

test("process operator can inspect governed instances and recovery controls", async ({ page }) => {
  await signIn(page);
  await page.goto(`${adminBaseUrl}/admin/processes/dashboard`);
  await expect(page.getByRole("heading", { name: "业务流程与 Saga 控制中心" })).toBeVisible();
  await expect(page.getByText("NOT CERTIFIED")).toBeVisible();
  await page.getByRole("link", { name: "状态机" }).click();
  await expect(page.getByRole("button", { name: "运行状态机验证" })).toBeVisible();
  await page.getByRole("link", { name: "卡死检测" }).click();
  await expect(page.getByRole("button", { name: "扫描卡死流程" })).toBeVisible();
});

test("process console exposes no direct domain-state editor", async ({ page }) => {
  await signIn(page);
  await page.goto(`${adminBaseUrl}/admin/processes/interventions`);
  await expect(page.getByText(/direct sql|直接修改状态|伪造支付/i)).toHaveCount(0);
});
