# UAT 套件（对应 references/UAT_CHECKLIST.md）

这套用例把清单里能自动化的部分跑成可执行证据，跑不了的部分**明确记为 `BLOCKED`**，
而不是跳过、也不是假装通过。

运行：

```bash
pnpm test:e2e:uat            # = playwright test --config playwright.uat.config.ts
```

## 它不会做的事

- **不写生产。** `e2e/uat/uat-context.ts` 里内置了生产域名清单
  （`vavactivity.vercel.app`、`vav-platform-api.onrender.com`）。任何写操作指向这些域名会直接抛错。
  默认值不是空的——空的默认值等于"要记得打开"的守卫，也就是没有守卫。
- **不指向 localhost。** UAT 按定义是外部验收；把沙箱结果记成 UAT 是清单里点名的阻断项。
- **不造账号、不造数据内容。** 身份一律来自环境变量，仓库里不存任何凭据。
- **不重试。** `retries: 0`。重试后才通过的用例不是证据，是发现。

## 必填环境变量

| 变量 | 说明 |
| --- | --- |
| `UAT_USER_WEB_URL` | 用户端地址 |
| `UAT_ADMIN_WEB_URL` | 管理端地址 |
| `UAT_API_BASE_URL` | API 根，含 `/api/v1` |

## 写操作

| 变量 | 说明 |
| --- | --- |
| `UAT_ALLOW_WRITES=yes` | 显式确认"这个环境可以被写脏" |
| `UAT_PRODUCTION_HOSTS` | 覆盖生产域名清单（仅当上面那两个域名确实不是生产时） |

不设 `UAT_ALLOW_WRITES` 时，写类用例（EVENT-ADMIN-001 / REG-001 / REG-002 / CHECKIN-001）
整体 skip，只读用例照常跑。

## 身份（用你已有的账号，不要新建）

| 变量 | 用途 |
| --- | --- |
| `UAT_MEMBER_EMAIL` / `UAT_MEMBER_PASSWORD` | 主会员 |
| `UAT_MEMBER_2_EMAIL` / `UAT_MEMBER_2_PASSWORD` | 第二会员，仅并发/候补用例需要 |
| `UAT_ADMIN_EMAIL` / `UAT_ADMIN_PASSWORD` | 管理员 |
| `UAT_STAFF_EMAIL` / `UAT_STAFF_PASSWORD` | 现场核销人员 |

会员走 `/auth/login`，管理员与 staff 走 `/admin/auth/login`。

## 数据前置（由你指定，套件不自己猜）

| 变量 | 哪个用例要 | 要求 |
| --- | --- | --- |
| `UAT_ACTIVITY_SLUG` | REG-001 | 开放报名、有免费票种、名额充足 |
| `UAT_WAITLIST_ACTIVITY_SLUG` | REG-002 | 余量小到两个并发报名会抢同一个位置 |
| `UAT_CHECKIN_ACTIVITY_SLUG` | CHECKIN-001 | 可核销，且主会员已确认报名 |
| `UAT_CHECKIN_LAST_FOUR` | CHECKIN-001 | 唯一命中的手机后四位 |
| `UAT_CHECKIN_AMBIGUOUS_LAST_FOUR` | CHECKIN-001 | 命中多人的后四位；给不出就记 `BLOCKED` |
| `UAT_DRAFT_ACTIVITY_SLUG` | CORE-001 | 一个草稿活动的 slug，用来验证它不对外可见 |

不填的话，相关用例记 `BLOCKED` 并说明缺什么，不会静默跳过。

## 证据身份

| 变量 | 说明 |
| --- | --- |
| `UAT_TESTER` | 执行人姓名，写进每条证据 |
| `UAT_FRONTEND_COMMIT` / `UAT_BACKEND_COMMIT` | 被测版本 |
| `UAT_ATTESTED` | 逗号分隔的 `PREFLIGHT-*` 用例 ID，见下 |
| `UAT_ARTIFACT_DIR` | 产物目录，默认 `test-results/uat` |
| `UAT_PROXY_SERVER` | 需要走代理时设置 |
| `UAT_MAIL_API_URL` | 目标有测试收件箱时填；不填则"注册后验证邮箱"一步记 `BLOCKED` |

## 必须由人确认的 5 项

这些在部署外部看不到，套件不会替你判断，默认 `BLOCKED`：

```
PREFLIGHT-migrations   从干净库迁移 + 重跑幂等
PREFLIGHT-seeds        合成种子可重复
PREFLIGHT-identities   测试身份与角色已核对
PREFLIGHT-monitoring   监控与日志可用且已脱敏
PREFLIGHT-backup       备份存在、恢复目标隔离
```

确认之后（是真去确认，不是为了让用例变绿）：

```bash
UAT_TESTER="你的名字" \
UAT_ATTESTED="PREFLIGHT-migrations,PREFLIGHT-seeds" \
pnpm test:e2e:uat
```

## 证据落在哪

每条用例通过 `testInfo.attach` 附一份 JSON：用例 ID、角色、前置、步骤、预期、实际、结论，
外加 run marker、时间、执行人、前后端 commit、目标地址。
`test-results/uat/uat-results.json` 是机器可读的汇总，`test-results/uat/html` 是可翻的报告。

## 与 `playwright.external-uat.config.ts` 的区别

那套是冒烟：只读、对生产安全、可以随便跑。这套会改数据、要真账号。
混在一起的结果只能二选一——要么写操作跑得太频繁，要么冒烟跑得太少。
