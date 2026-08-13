<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { membershipApi, type MembershipPlan, type MembershipSummary } from "@/features/memberships/api";

const route = useRoute();
const locale = computed(() => String(route.params.locale ?? "zh-CN"));
const accountView = computed(() => route.path.includes("/account/membership"));
const plans = ref<MembershipPlan[]>([]);
const plan = ref<MembershipPlan>();
const current = ref<MembershipSummary>();
const history = ref<Array<Record<string, unknown>>>([]);
const selectedPlan = ref("");
const preview = ref<Record<string, unknown>>();
const busy = ref(false);
const error = ref("");
const notice = ref("");

function quotaPercent(row: MembershipSummary["quotas"][number]) {
  return row.allocated_quantity > 0 ? Math.min(100, Math.round(((row.consumed_quantity + row.reserved_quantity) / row.allocated_quantity) * 100)) : 0;
}

async function load() {
  busy.value = true;
  error.value = "";
  try {
    plans.value = await membershipApi.plans(locale.value);
    const planCode = String(route.params.planCode ?? "");
    plan.value = planCode ? await membershipApi.plan(planCode, locale.value) : undefined;
    if (accountView.value) {
      [current.value, history.value] = await Promise.all([membershipApi.current(), membershipApi.history()]);
      selectedPlan.value = plans.value.find((item) => item.plan_code !== current.value?.plan_code)?.plan_code ?? "";
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "会员信息加载失败";
  } finally { busy.value = false; }
}

async function previewUpgrade() {
  if (!selectedPlan.value) return;
  busy.value = true;
  try { preview.value = await membershipApi.preview(selectedPlan.value, "upgrade"); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "变更预览失败"; }
  finally { busy.value = false; }
}

async function confirmUpgrade() {
  if (!selectedPlan.value || !window.confirm("确认后才会交由支付系统执行；权益不会提前生效。继续吗？")) return;
  busy.value = true;
  try {
    const request = await membershipApi.requestChange(selectedPlan.value, "upgrade");
    await membershipApi.confirmChange(String(request.id), Number(request.version));
    notice.value = "变更请求已确认，等待 Commerce 与 Entitlement 的权威回执。";
    preview.value = undefined;
    await load();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "会员变更失败"; }
  finally { busy.value = false; }
}

watch(() => route.fullPath, load);
onMounted(load);
</script>

<template>
  <main class="membership-page">
    <p class="eyebrow">
      BATCH 17 · ENTITLEMENT CONTROL
    </p>
    <h1>{{ accountView ? "我的会员" : "会员计划" }}</h1>
    <p class="intro">
      会员权益由已激活的 Entitlement 决定；任何计划都不能绕过安全、隐私、屏蔽或对方的硬性条件。
    </p>
    <p
      v-if="busy"
      role="status"
    >
      正在加载…
    </p>
    <p
      v-if="error"
      role="alert"
      class="alert error"
    >
      {{ error }}
    </p>
    <p
      v-if="notice"
      role="status"
      class="alert notice"
    >
      {{ notice }}
    </p>

    <article
      v-if="plan && !accountView"
      class="panel"
    >
      <RouterLink :to="`/${locale}/membership/plans`">
        ← 返回全部计划
      </RouterLink>
      <h2>{{ plan.name }}</h2><p>{{ plan.short_description }}</p>
      <ul>
        <li
          v-for="benefit in plan.benefits"
          :key="benefit.benefit_code"
        >
          <strong>{{ benefit.benefit_code }}</strong><span>{{ benefit.benefit_type }}</span>
        </li>
      </ul>
    </article>

    <section
      v-else-if="!accountView"
      class="cards content-card-grid"
    >
      <article
        v-for="item in plans"
        :key="item.plan_code"
        class="panel content-card content-card-body"
      >
        <p class="badge eyebrow content-card-kicker">
          {{ item.plan_type }}
        </p><h2 class="content-card-title">
          {{ item.name }}
        </h2><p class="content-card-summary">
          {{ item.short_description }}
        </p>
        <footer class="content-card-footer">
          <RouterLink
            class="text-link content-card-link"
            :to="`/${locale}/membership/plans/${item.plan_code}`"
          >
            查看权益与限制
            <span aria-hidden="true">→</span>
          </RouterLink>
        </footer>
      </article>
    </section>

    <template v-else-if="current">
      <article class="panel hero">
        <div><small>当前计划</small><h2>{{ current.plan_name }}</h2></div><div><strong>{{ current.status }}</strong><p>周期结束：{{ current.current_cycle_ends_at ?? "长期" }}</p></div>
      </article>
      <section class="grid">
        <article class="panel">
          <h2>权益</h2><ul>
            <li
              v-for="benefit in current.benefits"
              :key="benefit.benefit_code"
            >
              <strong>{{ benefit.benefit_code }}</strong><span>{{ benefit.benefit_type }}</span>
            </li>
          </ul>
        </article>
        <article class="panel">
          <h2>配额</h2><div
            v-for="quota in current.quotas"
            :key="quota.id"
            class="quota"
          >
            <div><strong>{{ quota.benefit_code }}</strong><span>剩余 {{ quota.remaining_quantity }} / {{ quota.allocated_quantity }}</span></div><progress
              :value="quotaPercent(quota)"
              max="100"
            />
          </div><p v-if="current.quotas.length === 0">
            当前计划没有计量型配额。
          </p>
        </article>
        <article class="panel">
          <h2>升级或变更</h2><select v-model="selectedPlan">
            <option value="">
              选择目标计划
            </option><option
              v-for="item in plans.filter((p) => p.plan_code !== current?.plan_code)"
              :key="item.plan_code"
              :value="item.plan_code"
            >
              {{ item.name }}
            </option>
          </select><button
            :disabled="!selectedPlan || busy"
            @click="previewUpgrade"
          >
            生成变更预览
          </button><div
            v-if="preview"
            class="preview"
          >
            <p>生效策略：{{ preview.effective_policy }}</p><p>价格由 Commerce Quote 确认；此页面不会自行计算或承诺金额。</p><button @click="confirmUpgrade">
              明确确认变更
            </button>
          </div>
        </article>
        <article class="panel">
          <h2>历史</h2><ul>
            <li
              v-for="item in history"
              :key="String(item.id)"
            >
              <strong>{{ item.plan_code }}</strong><span>{{ item.status }} · {{ item.source_type }}</span>
            </li>
          </ul>
        </article>
      </section>
      <p class="retention">
        取消或到期不会删除已购买内容、完成记录或用户历史；付费会员失效后回退免费计划。
      </p>
    </template>
  </main>
</template>

<style scoped>
.membership-page {
  margin: 0 auto;
  max-width: 1120px;
  padding: 3rem 1.25rem 5rem;
}

.eyebrow {
  color: var(--vav-color-primary);
  letter-spacing: 0.14em;
}

.intro,
.retention {
  color: var(--vav-color-muted);
  max-width: 780px;
}

.cards,
.grid {
  display: grid;
  gap: var(--vav-space-4);
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.panel {
  backdrop-filter: blur(18px);
  background: var(--vav-glass);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-lg);
  color: var(--vav-color-ink);
  display: flex;
  flex-direction: column;
  gap: var(--vav-space-3);
  padding: var(--vav-component-card-padding);
}

.hero {
  background: var(--vav-glass-strong);
  flex-direction: row;
  justify-content: space-between;
  margin: 1.2rem 0;
}

.badge {
  align-self: flex-start;
  background: rgb(229 129 141 / 14%);
  border-radius: var(--vav-radius-pill);
  padding: var(--vav-space-1) var(--vav-space-3);
}

.button,
button {
  align-self: flex-start;
  background: var(--vav-color-primary);
  border: 0;
  border-radius: var(--vav-radius-pill);
  color: white;
  cursor: pointer;
  padding: 0.7rem 1rem;
  text-decoration: none;
}

select {
  background: rgb(255 255 255 / 6%);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-sm);
  color: inherit;
  padding: 0.7rem;
  width: 100%;
}

.alert,
.preview {
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-sm);
  padding: var(--vav-space-3);
}

.error {
  background: rgb(239 136 146 / 14%);
}

.notice {
  background: rgb(119 183 167 / 14%);
}

ul {
  display: grid;
  gap: 0.65rem;
  list-style: none;
  padding: 0;
}

li,
.quota > div {
  display: flex;
  gap: var(--vav-space-4);
  justify-content: space-between;
}

.quota {
  display: grid;
  gap: 0.35rem;
}

progress {
  width: 100%;
}

.preview {
  background: rgb(255 255 255 / 4%);
}

@media (max-width: 640px) {
  .hero {
    flex-direction: column;
  }
}
</style>
