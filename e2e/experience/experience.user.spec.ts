import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

test.beforeAll(() => {
  execFileSync("docker", ["compose", "exec", "-T", "api", "python", "-m", "vav.cli.seed_permissions"]);
  execFileSync("docker", ["compose", "exec", "-T", "api", "python", "-m", "vav.cli.seed_experience"]);
  execFileSync("docker", ["compose", "exec", "-T", "api", "python", "-m", "vav.cli.seed_test_user", "--confirm-insecure-test-account"]);
});

async function loginUser(page: Page) {
  await page.goto("/zh-CN/auth/login");
  await page.getByLabel("邮箱").fill("test@example.com");
  await page.getByLabel("密码").fill("test");
  await page.getByRole("button", { name: "欢迎回来" }).click();
}

test("member can move from home to tasks journeys search and help without a dead end", async ({ page }) => {
  await loginUser(page);
  for (const path of ["account/home", "account/tasks", "account/journeys", "search", "help"]) {
    await page.goto(`/zh-CN/${path}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.getByRole("link", { name: "帮助", exact: true }).or(page.getByRole("link", { name: "帮助中心" })).first()).toBeVisible();
  }
});

test("global command palette is keyboard reachable", async ({ page }) => {
  await page.goto("/zh-CN/");
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "全站搜索与快捷导航" })).toBeVisible();
  await expect(page.getByLabel("输入内容、服务、任务或帮助")).toBeFocused();
});

test("anonymous search renders backend route-code results as working links", async ({ page }) => {
  await page.goto("/zh-CN/search?q=活动");
  const result = page.getByRole("link", { name: /活动.*查看可报名活动/ }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/zh-CN\/activities$/);
});
