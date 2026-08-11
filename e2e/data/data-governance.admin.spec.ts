import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { adminEmail, adminPassword, resetLoginRateLimits, seedSuperAdmin } from "../helpers";

const adminBaseUrl = process.env.E2E_ADMIN_WEB_URL ?? "http://localhost:5174";

test.beforeAll(() => {
  resetLoginRateLimits();
  execFileSync("docker", ["compose", "exec", "-T", "api", "python", "-m", "vav.cli.seed_permissions"], {
    stdio: "pipe"
  });
  execFileSync("docker", ["compose", "exec", "-T", "api", "python", "-m", "vav.cli.seed_data_governance"], {
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

test("data steward can inspect contracts lineage and erasure status", async ({ page }) => {
  await signIn(page);
  await page.goto(`${adminBaseUrl}/admin/data-governance/dashboard`);
  await expect(page.getByRole("heading", { name: "数据治理与完整性中心" })).toBeVisible();
  await expect(page.getByText("NOT CERTIFIED")).toBeVisible();
  await page.getByRole("link", { name: "数据血缘" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("link", { name: "删除传播" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("data governance exposes no direct business-fact editor", async ({ page }) => {
  await signIn(page);
  await page.goto(`${adminBaseUrl}/admin/data-governance/repairs`);
  await expect(page.getByText(/direct sql|mark paid|直接修改支付|伪造同意/i)).toHaveCount(0);
});
