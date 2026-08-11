<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SearchBox } from "@vav/search-components";

import { experienceApi, type ExperienceRow } from "@/features/experience/api";
import {
  presentSearchResult,
  resolveSearchDestination
} from "@/features/experience/search-presentation";
import { useSeo } from "@/composables/useSeo";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const query = ref("");
const submittedQuery = ref("");
const results = ref<ExperienceRow[]>([]);
const busy = ref(false);
const error = ref("");
const hasSearched = ref(false);
let requestVersion = 0;

const locale = computed(() => String(route.params.locale ?? "zh-CN"));
const isAuthenticated = computed(() => Boolean(auth.user));
const resultStatus = computed(() => {
  if (busy.value) return `正在搜索“${submittedQuery.value}”`;
  if (error.value) return "搜索暂时不可用";
  if (!hasSearched.value) return "";
  return results.value.length
    ? `找到 ${results.value.length} 个可见结果`
    : `没有找到与“${submittedQuery.value}”相关的结果`;
});

const popularSearches = ["活动", "课程", "辅导", "会员", "安全支持"];
const discoveryLinks = computed(() => [
  {
    eyebrow: "参与与连接",
    title: "浏览近期活动",
    description: "从主题活动开始，查看时间、地点与报名方式。",
    to: `/${locale.value}/activities`,
    marker: "活"
  },
  {
    eyebrow: "学习与成长",
    title: "发现课程",
    description: "按自己的节奏探索课程、练习和学习服务。",
    to: `/${locale.value}/courses`,
    marker: "课"
  },
  {
    eyebrow: "支持与陪伴",
    title: "了解辅导服务",
    description: "查看可用服务与边界，再决定是否预约。",
    to: `/${locale.value}/counseling`,
    marker: "辅"
  }
]);

useSeo(computed(() => ({
  title: submittedQuery.value ? `${submittedQuery.value}的搜索结果` : "全站搜索",
  description: "搜索 VAV 的活动、课程、辅导、会员服务与帮助内容。"
})));

function routeQueryValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

async function load(rawQuery: string) {
  const normalized = rawQuery.trim();
  const currentRequest = ++requestVersion;
  query.value = normalized;
  submittedQuery.value = normalized;
  error.value = "";
  results.value = [];

  if (!normalized) {
    busy.value = false;
    hasSearched.value = false;
    return;
  }

  busy.value = true;
  hasSearched.value = true;
  try {
    await auth.bootstrap();
    const nextResults = await experienceApi.search(normalized, Boolean(auth.user));
    if (currentRequest === requestVersion) results.value = nextResults;
  } catch (cause) {
    if (currentRequest === requestVersion) {
      error.value = cause instanceof Error ? cause.message : "搜索服务暂时无法连接";
    }
  } finally {
    if (currentRequest === requestVersion) busy.value = false;
  }
}

function submitSearch(value = query.value) {
  const normalized = value.trim();
  const current = routeQueryValue(route.query.q).trim();
  if (normalized === current) {
    void load(normalized);
    return;
  }

  const nextQuery = { ...route.query };
  if (normalized) nextQuery.q = normalized;
  else delete nextQuery.q;
  void router.push({ query: nextQuery });
}

function clearSearch() {
  if (route.query.q === undefined) {
    void load("");
    return;
  }
  const nextQuery = { ...route.query };
  delete nextQuery.q;
  void router.push({ query: nextQuery });
}

function selectPopularSearch(value: string) {
  query.value = value;
  submitSearch(value);
}

function resultKey(row: ExperienceRow, index: number) {
  return String(row.id ?? row.document_code ?? row.route_code ?? `${submittedQuery.value}-${index}`);
}

watch(
  () => route.query.q,
  (value) => void load(routeQueryValue(value)),
  { immediate: true }
);
</script>

<template>
  <section class="search-page">
    <div
      class="search-page__glow search-page__glow--one"
      aria-hidden="true"
    />
    <div
      class="search-page__glow search-page__glow--two"
      aria-hidden="true"
    />

    <div class="search-page__inner">
      <nav
        class="search-breadcrumbs"
        aria-label="面包屑"
      >
        <RouterLink :to="`/${locale}/`">
          首页
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span aria-current="page">全站搜索</span>
      </nav>

      <header class="search-hero">
        <p class="search-hero__eyebrow">
          EXPLORE VAV
        </p>
        <h1>找到你需要的服务与下一步</h1>
        <p class="search-hero__lead">
          搜索活动、课程、辅导、会员服务与帮助内容。登录后还可查找仅自己可见的任务和状态。
        </p>

        <div class="search-hero__form">
          <SearchBox
            v-model="query"
            input-id="global-search-page-query"
            label="搜索 VAV 全站内容"
            placeholder="例如：活动、课程、安全支持"
            hint="搜索结果会根据登录状态、权限和隐私设置自动过滤。"
            :busy="busy"
            @search="submitSearch"
            @clear="clearSearch"
          />
          <div class="popular-searches">
            <span>热门搜索</span>
            <button
              v-for="item in popularSearches"
              :key="item"
              type="button"
              @click="selectPopularSearch(item)"
            >
              {{ item }}
            </button>
          </div>
        </div>
      </header>

      <p
        class="search-page__status"
        role="status"
        aria-live="polite"
      >
        {{ resultStatus }}
      </p>

      <div class="search-layout">
        <div class="search-content">
          <section
            v-if="busy"
            class="search-results"
            aria-label="正在加载搜索结果"
          >
            <div class="results-heading">
              <div>
                <p>SEARCHING</p>
                <h2>正在整理与你相关的结果</h2>
              </div>
            </div>
            <div
              v-for="index in 3"
              :key="index"
              class="search-skeleton"
              aria-hidden="true"
            >
              <span />
              <div><i /><i /><i /></div>
            </div>
          </section>

          <section
            v-else-if="error"
            class="search-message search-message--error"
            role="alert"
            aria-labelledby="search-error-title"
          >
            <span
              class="search-message__symbol"
              aria-hidden="true"
            >!</span>
            <p class="search-message__eyebrow">
              CONNECTION PAUSED
            </p>
            <h2 id="search-error-title">
              暂时无法完成搜索
            </h2>
            <p>{{ error }}</p>
            <button
              type="button"
              @click="load(submittedQuery)"
            >
              重新搜索
            </button>
          </section>

          <section
            v-else-if="hasSearched && results.length"
            class="search-results"
            aria-labelledby="search-results-title"
          >
            <div class="results-heading">
              <div>
                <p>SEARCH RESULTS</p>
                <h2 id="search-results-title">
                  “{{ submittedQuery }}”的可见结果
                </h2>
              </div>
              <span>{{ results.length }} 项</span>
            </div>
            <ol class="results-list">
              <li
                v-for="(row, index) in results"
                :key="resultKey(row, index)"
              >
                <RouterLink
                  class="result-card"
                  :to="resolveSearchDestination(row, locale, isAuthenticated)"
                >
                  <span
                    class="result-card__marker"
                    aria-hidden="true"
                  >
                    {{ presentSearchResult(row).marker }}
                  </span>
                  <span class="result-card__copy">
                    <span class="result-card__meta">
                      {{ presentSearchResult(row).category }}
                    </span>
                    <strong>{{ presentSearchResult(row).title }}</strong>
                    <span>{{ presentSearchResult(row).summary }}</span>
                  </span>
                  <span class="result-card__action">
                    查看
                    <span aria-hidden="true">↗</span>
                  </span>
                </RouterLink>
              </li>
            </ol>
          </section>

          <section
            v-else-if="hasSearched"
            class="search-message"
            aria-labelledby="search-empty-title"
          >
            <span
              class="search-message__symbol"
              aria-hidden="true"
            >⌕</span>
            <p class="search-message__eyebrow">
              NO VISIBLE RESULTS
            </p>
            <h2 id="search-empty-title">
              没有找到“{{ submittedQuery }}”
            </h2>
            <p>试试更短的关键词，或从活动、课程、辅导和帮助中心继续浏览。</p>
            <div class="search-message__actions">
              <button
                type="button"
                @click="clearSearch"
              >
                清除关键词
              </button>
              <RouterLink :to="`/${locale}/help`">
                前往帮助中心
              </RouterLink>
            </div>
          </section>

          <section
            v-else
            class="search-discovery"
            aria-labelledby="search-discovery-title"
          >
            <div class="results-heading">
              <div>
                <p>START HERE</p>
                <h2 id="search-discovery-title">
                  从常用入口开始
                </h2>
              </div>
            </div>
            <div class="discovery-grid">
              <RouterLink
                v-for="item in discoveryLinks"
                :key="item.title"
                :to="item.to"
                class="discovery-card"
              >
                <span
                  class="discovery-card__marker"
                  aria-hidden="true"
                >{{ item.marker }}</span>
                <span class="discovery-card__eyebrow">{{ item.eyebrow }}</span>
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
                <i aria-hidden="true">↗</i>
              </RouterLink>
            </div>
          </section>
        </div>

        <aside
          class="search-aside"
          aria-label="搜索说明与支持"
        >
          <section>
            <span class="search-aside__index">01</span>
            <p class="search-aside__eyebrow">
              YOUR VIEW
            </p>
            <h2>只显示你有权查看的内容</h2>
            <p>权限、隐私和安全过滤由服务端执行。搜索结果不会暴露其他用户的个人内容。</p>
            <RouterLink
              v-if="!isAuthenticated"
              :to="{ path: `/${locale}/auth/login`, query: { returnTo: route.fullPath } }"
            >
              登录后搜索个人内容
              <span aria-hidden="true">→</span>
            </RouterLink>
            <RouterLink
              v-else
              :to="`/${locale}/account/privacy`"
            >
              查看隐私设置
              <span aria-hidden="true">→</span>
            </RouterLink>
          </section>
          <section>
            <span class="search-aside__index">02</span>
            <p class="search-aside__eyebrow">
              NEED A HAND?
            </p>
            <h2>还没找到下一步？</h2>
            <p>帮助中心会解释页面状态、服务边界和可用的恢复路径。</p>
            <RouterLink :to="`/${locale}/help`">
              打开帮助中心
              <span aria-hidden="true">→</span>
            </RouterLink>
          </section>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search-page {
  --vav-color-action-primary: #e5818d;
  --vav-color-action-primary-hover: #f29ba5;
  --vav-color-border: rgb(222 235 241 / 18%);
  --vav-color-focus: #8ed5e0;
  --vav-color-on-action: #091722;
  --vav-color-surface-raised: #132632;
  --vav-color-surface-soft: #1c3340;
  --vav-color-text: #f5f7f8;
  --vav-color-text-muted: #b7c2c7;
  color: var(--vav-color-text);
  min-height: 72vh;
  overflow: hidden;
  padding: clamp(3rem, 7vw, 6rem) clamp(1.25rem, 5vw, 5rem) clamp(5rem, 9vw, 8rem);
  position: relative;
}

:global([data-vav-theme="high-contrast"]) .search-page {
  --vav-color-action-primary: #ffbf00;
  --vav-color-action-primary-hover: #ffd766;
  --vav-color-border: #ffffff;
  --vav-color-focus: #ffbf00;
  --vav-color-on-action: #000000;
  --vav-color-surface-raised: #000000;
  --vav-color-surface-soft: #1f1f1f;
  --vav-color-text: #ffffff;
  --vav-color-text-muted: #ffffff;
}

.search-page__inner {
  margin: 0 auto;
  max-width: 82rem;
  position: relative;
  z-index: 1;
}

.search-page__glow {
  border-radius: 50%;
  filter: blur(1px);
  opacity: 0.55;
  pointer-events: none;
  position: absolute;
}

.search-page__glow--one {
  background: radial-gradient(circle, rgb(229 129 141 / 20%), transparent 68%);
  height: 38rem;
  right: -16rem;
  top: -12rem;
  width: 38rem;
}

.search-page__glow--two {
  background: radial-gradient(circle, rgb(90 159 187 / 16%), transparent 68%);
  height: 32rem;
  left: -14rem;
  top: 24rem;
  width: 32rem;
}

.search-breadcrumbs {
  align-items: center;
  color: var(--vav-color-text-muted);
  display: flex;
  font-size: var(--vav-font-size-xs);
  gap: var(--vav-space-2);
  margin-bottom: clamp(3rem, 7vw, 6rem);
}

.search-breadcrumbs a {
  text-decoration: none;
}

.search-breadcrumbs a:hover {
  color: var(--vav-color-text);
}

.search-hero {
  max-width: 64rem;
}

.search-hero__eyebrow,
.results-heading p,
.search-message__eyebrow,
.search-aside__eyebrow,
.discovery-card__eyebrow {
  color: var(--vav-color-action-primary);
  font-size: var(--vav-font-size-xs);
  font-weight: 700;
  letter-spacing: 0.18em;
  margin: 0;
  text-transform: uppercase;
}

.search-hero h1 {
  font-size: clamp(2.75rem, 6vw, 5.8rem);
  font-weight: 350;
  letter-spacing: -0.06em;
  line-height: 1.04;
  margin: var(--vav-space-4) 0;
  max-width: 10.5em;
  text-wrap: balance;
}

.search-hero__lead {
  color: var(--vav-color-text-muted);
  font-size: clamp(1rem, 1.5vw, 1.2rem);
  line-height: var(--vav-line-height-relaxed);
  margin: 0;
  max-width: 42rem;
}

.search-hero__form {
  backdrop-filter: blur(22px);
  background: color-mix(in srgb, var(--vav-color-surface-raised) 70%, transparent);
  border: 1px solid var(--vav-color-border);
  border-radius: calc(var(--vav-radius-lg) + 0.35rem);
  box-shadow: var(--vav-shadow-soft);
  margin-top: clamp(2rem, 5vw, 3.5rem);
  padding: clamp(1rem, 3vw, 1.75rem);
}

.popular-searches {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--vav-space-2);
  margin-top: var(--vav-space-4);
}

.popular-searches > span {
  color: var(--vav-color-text-muted);
  font-size: var(--vav-font-size-xs);
  margin-inline-end: var(--vav-space-1);
}

.popular-searches button,
.search-message button,
.search-message a {
  background: transparent;
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-pill);
  color: var(--vav-color-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--vav-font-size-sm);
  min-height: var(--vav-component-touch-target-minimum);
  padding: var(--vav-space-2) var(--vav-space-4);
  text-decoration: none;
  transition: background var(--vav-motion-duration-fast) var(--vav-motion-easing-standard),
    border-color var(--vav-motion-duration-fast) var(--vav-motion-easing-standard);
}

.popular-searches button:hover,
.search-message button:hover,
.search-message a:hover {
  background: var(--vav-color-surface-soft);
  border-color: var(--vav-color-action-primary);
}

.search-page__status {
  height: 0;
  margin: 0;
  overflow: hidden;
  width: 0;
}

.search-layout {
  align-items: start;
  display: grid;
  gap: clamp(2rem, 5vw, 5rem);
  grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem);
  margin-top: clamp(4rem, 8vw, 7rem);
}

.search-content {
  min-width: 0;
}

.results-heading {
  align-items: end;
  display: flex;
  gap: var(--vav-space-4);
  justify-content: space-between;
  margin-bottom: var(--vav-space-6);
}

.results-heading h2 {
  font-size: clamp(1.7rem, 3vw, 2.6rem);
  font-weight: 400;
  letter-spacing: -0.035em;
  margin: var(--vav-space-2) 0 0;
}

.results-heading > span {
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-pill);
  color: var(--vav-color-text-muted);
  flex: 0 0 auto;
  font-size: var(--vav-font-size-xs);
  padding: var(--vav-space-2) var(--vav-space-3);
}

.results-list {
  display: grid;
  gap: var(--vav-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}

.result-card {
  align-items: center;
  backdrop-filter: blur(14px);
  background: color-mix(in srgb, var(--vav-color-surface-raised) 62%, transparent);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-lg);
  display: grid;
  gap: var(--vav-space-4);
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: clamp(1.15rem, 3vw, 1.6rem);
  text-decoration: none;
  transition: background var(--vav-motion-duration-normal) var(--vav-motion-easing-standard),
    border-color var(--vav-motion-duration-normal) var(--vav-motion-easing-standard),
    transform var(--vav-motion-duration-normal) var(--vav-motion-easing-standard);
}

.result-card:hover {
  background: var(--vav-color-surface-raised);
  border-color: color-mix(in srgb, var(--vav-color-action-primary) 65%, var(--vav-color-border));
  transform: translateY(-2px);
}

.result-card__marker,
.discovery-card__marker {
  align-items: center;
  background: linear-gradient(145deg, rgb(229 129 141 / 24%), rgb(82 144 172 / 18%));
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: var(--vav-radius-md);
  color: var(--vav-color-action-primary);
  display: inline-flex;
  font-size: 1.1rem;
  height: 3.25rem;
  justify-content: center;
  width: 3.25rem;
}

.result-card__copy {
  display: grid;
  gap: var(--vav-space-1);
  min-width: 0;
}

.result-card__copy strong {
  font-size: var(--vav-font-size-lg);
  font-weight: 600;
}

.result-card__copy > span:last-child {
  color: var(--vav-color-text-muted);
  line-height: var(--vav-line-height-normal);
}

.result-card__meta {
  color: var(--vav-color-action-primary);
  font-size: var(--vav-font-size-xs);
}

.result-card__action {
  align-items: center;
  color: var(--vav-color-text-muted);
  display: inline-flex;
  font-size: var(--vav-font-size-sm);
  gap: var(--vav-space-2);
}

.result-card:hover .result-card__action {
  color: var(--vav-color-text);
}

.search-message {
  align-items: center;
  background: color-mix(in srgb, var(--vav-color-surface-raised) 65%, transparent);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-lg);
  display: flex;
  flex-direction: column;
  min-height: 27rem;
  justify-content: center;
  padding: clamp(2rem, 6vw, 4rem);
  text-align: center;
}

.search-message--error {
  border-color: color-mix(in srgb, var(--vav-color-danger) 55%, var(--vav-color-border));
}

.search-message__symbol {
  align-items: center;
  border: 1px solid var(--vav-color-border);
  border-radius: 50%;
  color: var(--vav-color-action-primary);
  display: inline-flex;
  font-size: 1.5rem;
  height: 4rem;
  justify-content: center;
  margin-bottom: var(--vav-space-6);
  width: 4rem;
}

.search-message h2 {
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  font-weight: 400;
  margin: var(--vav-space-3) 0;
}

.search-message > p:not(.search-message__eyebrow) {
  color: var(--vav-color-text-muted);
  line-height: var(--vav-line-height-relaxed);
  margin: 0;
  max-width: 32rem;
}

.search-message > button {
  margin-top: var(--vav-space-6);
}

.search-message__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vav-space-3);
  justify-content: center;
  margin-top: var(--vav-space-6);
}

.discovery-grid {
  display: grid;
  gap: var(--vav-space-3);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.discovery-card {
  background: color-mix(in srgb, var(--vav-color-surface-raised) 52%, transparent);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-lg);
  display: flex;
  flex-direction: column;
  min-height: 20rem;
  padding: clamp(1.25rem, 3vw, 1.75rem);
  position: relative;
  text-decoration: none;
  transition: background var(--vav-motion-duration-normal) var(--vav-motion-easing-standard),
    transform var(--vav-motion-duration-normal) var(--vav-motion-easing-standard);
}

.discovery-card:hover {
  background: var(--vav-color-surface-raised);
  transform: translateY(-3px);
}

.discovery-card__marker {
  margin-bottom: auto;
}

.discovery-card strong {
  font-size: var(--vav-font-size-lg);
  margin: var(--vav-space-3) 0 var(--vav-space-2);
}

.discovery-card > span:not(.discovery-card__marker, .discovery-card__eyebrow) {
  color: var(--vav-color-text-muted);
  font-size: var(--vav-font-size-sm);
  line-height: var(--vav-line-height-normal);
}

.discovery-card i {
  font-style: normal;
  position: absolute;
  right: var(--vav-space-4);
  top: var(--vav-space-4);
}

.search-aside {
  border-top: 1px solid var(--vav-color-border);
  display: grid;
}

.search-aside section {
  border-bottom: 1px solid var(--vav-color-border);
  padding: var(--vav-space-6) 0;
}

.search-aside__index {
  color: var(--vav-color-text-muted);
  display: block;
  font-family: var(--vav-font-mono);
  font-size: var(--vav-font-size-xs);
  margin-bottom: var(--vav-space-8);
}

.search-aside h2 {
  font-size: var(--vav-font-size-lg);
  font-weight: 550;
  line-height: var(--vav-line-height-tight);
  margin: var(--vav-space-3) 0;
}

.search-aside p:not(.search-aside__eyebrow) {
  color: var(--vav-color-text-muted);
  font-size: var(--vav-font-size-sm);
  line-height: var(--vav-line-height-relaxed);
}

.search-aside a {
  align-items: center;
  color: var(--vav-color-action-primary);
  display: flex;
  font-size: var(--vav-font-size-sm);
  gap: var(--vav-space-2);
  justify-content: space-between;
  margin-top: var(--vav-space-4);
  text-decoration: none;
}

.search-skeleton {
  align-items: center;
  background: color-mix(in srgb, var(--vav-color-surface-raised) 58%, transparent);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-lg);
  display: grid;
  gap: var(--vav-space-4);
  grid-template-columns: auto minmax(0, 1fr);
  margin-bottom: var(--vav-space-3);
  padding: var(--vav-space-6);
}

.search-skeleton > span,
.search-skeleton i {
  animation: search-skeleton-pulse 1.4s ease-in-out infinite;
  background: var(--vav-color-surface-soft);
  border-radius: var(--vav-radius-pill);
  display: block;
}

.search-skeleton > span {
  border-radius: var(--vav-radius-md);
  height: 3.25rem;
  width: 3.25rem;
}

.search-skeleton > div {
  display: grid;
  gap: var(--vav-space-2);
}

.search-skeleton i {
  height: 0.75rem;
  width: 35%;
}

.search-skeleton i:nth-child(2) {
  height: 1.1rem;
  width: 55%;
}

.search-skeleton i:nth-child(3) {
  width: 80%;
}

@keyframes search-skeleton-pulse {
  50% {
    opacity: 0.45;
  }
}

@media (max-width: 64rem) {
  .search-layout {
    grid-template-columns: 1fr;
  }

  .search-aside {
    gap: var(--vav-space-6);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-aside section {
    border: 1px solid var(--vav-color-border);
    border-radius: var(--vav-radius-lg);
    padding: var(--vav-space-6);
  }
}

@media (max-width: 48rem) {
  .search-page {
    padding-top: 8rem;
  }

  .search-breadcrumbs {
    margin-bottom: var(--vav-space-12);
  }

  .discovery-grid,
  .search-aside {
    grid-template-columns: 1fr;
  }

  .discovery-card {
    min-height: 16rem;
  }
}

@media (max-width: 36rem) {
  .result-card {
    align-items: start;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .result-card__action {
    grid-column: 2;
  }

  .popular-searches > span {
    flex-basis: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .result-card,
  .discovery-card,
  .popular-searches button {
    transition: none;
  }

  .search-skeleton > span,
  .search-skeleton i {
    animation: none;
  }
}
</style>
