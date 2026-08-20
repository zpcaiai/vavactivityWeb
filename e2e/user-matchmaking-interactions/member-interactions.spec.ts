import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  recommendationFixturePassword,
  resetLoginRateLimits,
  seedMatchmakingInteractionFixture
} from "../helpers";

let senderEmail = "";

test.beforeAll(() => {
  resetLoginRateLimits();
  senderEmail = seedMatchmakingInteractionFixture();
});

async function signIn(page: Page) {
  await page.goto("/zh-CN/auth/login");
  await page.getByLabel("邮箱或账号").fill(senderEmail);
  await page.getByLabel("密码").fill(recommendationFixturePassword);
  await page.getByRole("button", { name: "欢迎回来" }).click();
  await expect(page).toHaveURL(/\/zh-CN\/account\/security$/u);
}

test("a member sees the mutual match and the separate pending invitation", async ({ page }) => {
  await signIn(page);
  await page.goto("/zh-CN/account/matchmaking/matches");
  await expect(page.getByRole("heading", { name: "双方互选", exact: true })).toBeVisible();
  await expect(page.getByText("单向喜欢始终保密，对方不会收到通知。")).toBeVisible();
  await expect(page.getByText("invitation_pending").first()).toBeVisible();

  await page.goto("/zh-CN/account/matchmaking/invitations");
  await expect(page.getByRole("heading", { name: /我发出的邀请|我收到的邀请/u }).first()).toBeVisible();
  await expect(page.getByText("pending").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "查看邀请" }).first()).toBeVisible();
});

test("member navigation exposes only outgoing choices, never incoming likes", async ({ page }) => {
  await signIn(page);
  await page.goto("/zh-CN/account/matchmaking/likes");
  await expect(
    page.getByRole("navigation", { name: "互动分区" }).getByRole("link", { name: "我的喜欢" })
  ).toBeVisible();
  await expect(page.getByText(/收到的喜欢|谁喜欢了我/u)).toHaveCount(0);
  await expect(page.getByText(/单向喜欢不会通知对方，也不会暴露对方是否选择了你/u)).toBeVisible();
});
