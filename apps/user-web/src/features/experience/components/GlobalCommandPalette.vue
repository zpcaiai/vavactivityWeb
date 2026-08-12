<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { SearchBox } from "@vav/search-components";

import { experienceApi, type ExperienceRow } from "@/features/experience/api";
import {
  presentSearchResult,
  resolveSearchDestination
} from "@/features/experience/search-presentation";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const auth = useAuthStore();
const dialog = ref<HTMLDialogElement>();
const searchBox = ref<{ focus: () => void }>();
const trigger = ref<HTMLButtonElement>();
const query = ref("");
const submittedQuery = ref("");
const results = ref<ExperienceRow[]>([]);
const busy = ref(false);
const error = ref("");
const hasSearched = ref(false);
let requestVersion = 0;

const locale = computed(() => String(route.params.locale ?? "zh-CN"));
const isAuthenticated = computed(() => Boolean(auth.user));
const fullSearchRoute = computed(() => ({
  path: `/${locale.value}/search`,
  query: query.value.trim() ? { q: query.value.trim() } : undefined
}));
const popularSearches = ["活动", "课程", "辅导", "会员", "安全支持"];

function keyHandler(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const isEditable = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable) {
    event.preventDefault();
    void open();
  }
}

async function open() {
  if (!dialog.value?.open) dialog.value?.showModal();
  await nextTick();
  searchBox.value?.focus();
}

async function search(value = query.value) {
  const normalized = value.trim();
  const currentRequest = ++requestVersion;
  query.value = normalized;
  submittedQuery.value = normalized;
  results.value = [];
  error.value = "";

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

function selectPopularSearch(value: string) {
  query.value = value;
  void search(value);
}

function resetSearch() {
  requestVersion += 1;
  query.value = "";
  submittedQuery.value = "";
  results.value = [];
  busy.value = false;
  error.value = "";
  hasSearched.value = false;
}

function close() {
  dialog.value?.close();
}

function handleClose() {
  resetSearch();
  trigger.value?.focus();
}

function resultKey(row: ExperienceRow, index: number) {
  return String(row.id ?? row.document_code ?? row.route_code ?? `${submittedQuery.value}-${index}`);
}

onMounted(() => window.addEventListener("keydown", keyHandler));
onBeforeUnmount(() => window.removeEventListener("keydown", keyHandler));
</script>

<template>
  <button
    ref="trigger"
    class="palette-trigger"
    type="button"
    aria-label="打开全站搜索"
    aria-haspopup="dialog"
    aria-controls="global-search-dialog"
    aria-keyshortcuts="/"
    @click="open"
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="10.5"
        cy="10.5"
        r="5.75"
      />
      <path d="m15 15 4.25 4.25" />
    </svg>
    <span>搜索全站</span>
    <kbd>/</kbd>
  </button>

  <dialog
    id="global-search-dialog"
    ref="dialog"
    class="palette-dialog"
    aria-labelledby="palette-title"
    @close="handleClose"
  >
    <div class="palette-dialog__header">
      <div class="palette-dialog__heading">
        <span
          class="palette-dialog__mark"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="10.5"
              cy="10.5"
              r="5.75"
            />
            <path d="m15 15 4.25 4.25" />
          </svg>
        </span>
        <div>
          <p>VAV QUICK FIND</p>
          <h2 id="palette-title">
            全站搜索与快捷导航
          </h2>
        </div>
      </div>
      <form method="dialog">
        <button
          class="palette-dialog__close"
          type="submit"
          aria-label="关闭搜索"
        >
          <span aria-hidden="true">×</span>
        </button>
      </form>
    </div>

    <SearchBox
      ref="searchBox"
      v-model="query"
      input-id="palette-query"
      label="输入内容、服务、任务或帮助"
      placeholder="输入关键词"
      :busy="busy"
      compact
      @search="search"
      @clear="resetSearch"
    />

    <div class="palette-dialog__body">
      <section
        v-if="!hasSearched && !busy"
        aria-labelledby="palette-popular-title"
      >
        <div class="palette-section-heading">
          <h3 id="palette-popular-title">
            热门搜索
          </h3>
          <span>选择一个关键词开始</span>
        </div>
        <div class="palette-suggestions">
          <button
            v-for="item in popularSearches"
            :key="item"
            type="button"
            @click="selectPopularSearch(item)"
          >
            <span aria-hidden="true">⌕</span>
            {{ item }}
          </button>
        </div>
      </section>

      <section
        v-else-if="busy"
        class="palette-loading"
        aria-label="正在搜索"
      >
        <div
          v-for="index in 3"
          :key="index"
          aria-hidden="true"
        >
          <i /><span><i /><i /></span>
        </div>
      </section>

      <section
        v-else-if="error"
        class="palette-state palette-state--error"
        role="alert"
      >
        <span aria-hidden="true">!</span>
        <div>
          <h3>暂时无法完成搜索</h3>
          <p>{{ error }}</p>
          <button
            type="button"
            @click="search(submittedQuery)"
          >
            重试
          </button>
        </div>
      </section>

      <section
        v-else-if="results.length"
        aria-labelledby="palette-results-title"
      >
        <div class="palette-section-heading">
          <h3 id="palette-results-title">
            搜索结果
          </h3>
          <span>{{ results.length }} 个可见结果</span>
        </div>
        <ul
          class="palette-results"
          aria-live="polite"
        >
          <li
            v-for="(row, index) in results"
            :key="resultKey(row, index)"
          >
            <RouterLink
              :to="resolveSearchDestination(row, locale, isAuthenticated)"
              @click="close"
            >
              <span
                class="palette-result__marker"
                aria-hidden="true"
              >
                {{ presentSearchResult(row).marker }}
              </span>
              <span class="palette-result__copy">
                <small>{{ presentSearchResult(row).category }}</small>
                <strong>{{ presentSearchResult(row).title }}</strong>
                <span>{{ presentSearchResult(row).summary }}</span>
              </span>
              <span
                class="palette-result__arrow"
                aria-hidden="true"
              >↗</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section
        v-else
        class="palette-state"
        aria-live="polite"
      >
        <span aria-hidden="true">⌕</span>
        <div>
          <h3>没有找到“{{ submittedQuery }}”</h3>
          <p>试试更短的关键词。权限、隐私和安全过滤始终由服务端执行。</p>
        </div>
      </section>
    </div>

    <footer class="palette-dialog__footer">
      <span>按 <kbd>Esc</kbd> 关闭</span>
      <RouterLink
        :to="fullSearchRoute"
        @click="close"
      >
        打开完整搜索页
        <span aria-hidden="true">→</span>
      </RouterLink>
    </footer>
  </dialog>
</template>

<style scoped>
.palette-trigger {
  align-items: center;
  background: rgb(255 255 255 / 5%);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-pill);
  color: rgb(239 245 248 / 76%);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: var(--vav-font-size-xs);
  gap: var(--vav-space-2);
  min-height: var(--vav-component-touch-target-minimum);
  padding: var(--vav-space-2) var(--vav-space-3);
  transition: background var(--vav-motion-duration-fast) var(--vav-motion-easing-standard),
    border-color var(--vav-motion-duration-fast) var(--vav-motion-easing-standard);
}

.palette-trigger:hover {
  background: rgb(255 255 255 / 10%);
  border-color: rgb(229 129 141 / 55%);
  color: white;
}

.palette-trigger svg,
.palette-dialog__mark svg {
  height: 1.15rem;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-width: 1.7;
  width: 1.15rem;
}

kbd {
  border: 1px solid currentcolor;
  border-radius: var(--vav-radius-sm);
  color: inherit;
  font: inherit;
  line-height: 1.5;
  min-width: 1.45rem;
  opacity: 0.68;
  padding-inline: 0.32rem;
  text-align: center;
}

.palette-dialog {
  backdrop-filter: blur(30px);
  background: var(--vav-color-surface-raised);
  border: 1px solid var(--vav-color-border);
  border-radius: calc(var(--vav-radius-lg) + 0.25rem);
  box-shadow: var(--vav-component-elevation-overlay);
  color: var(--vav-color-text);
  margin-block: min(11vh, 6rem) auto;
  max-height: min(80vh, 48rem);
  overflow: hidden;
  padding: 0;
  width: min(44rem, calc(100% - 2rem));
}

.palette-dialog::backdrop {
  backdrop-filter: blur(10px);
  background: var(--vav-color-overlay);
}

.palette-dialog__header {
  align-items: center;
  border-bottom: 1px solid var(--vav-color-border);
  display: flex;
  gap: var(--vav-space-4);
  justify-content: space-between;
  padding: var(--vav-space-6);
}

.palette-dialog__heading {
  align-items: center;
  display: flex;
  gap: var(--vav-space-3);
}

.palette-dialog__mark {
  align-items: center;
  background: rgb(229 129 141 / 14%);
  border: 1px solid rgb(229 129 141 / 28%);
  border-radius: var(--vav-radius-md);
  color: var(--vav-color-action-primary);
  display: inline-flex;
  height: 2.75rem;
  justify-content: center;
  width: 2.75rem;
}

.palette-dialog__heading p {
  color: var(--vav-color-action-primary);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.17em;
  margin: 0 0 var(--vav-space-1);
}

.palette-dialog__heading h2 {
  font-size: var(--vav-font-size-lg);
  font-weight: 550;
  letter-spacing: -0.025em;
  margin: 0;
}

.palette-dialog__close {
  align-items: center;
  background: transparent;
  border: 1px solid var(--vav-color-border);
  border-radius: 50%;
  color: var(--vav-color-text-muted);
  cursor: pointer;
  display: inline-flex;
  font-size: 1.35rem;
  height: var(--vav-component-touch-target-minimum);
  justify-content: center;
  width: var(--vav-component-touch-target-minimum);
}

.palette-dialog__close:hover {
  background: var(--vav-color-surface-soft);
  color: var(--vav-color-text);
}

.palette-dialog > .vav-search-box {
  padding: var(--vav-space-6) var(--vav-space-6) var(--vav-space-4);
}

.palette-dialog__body {
  max-height: 24rem;
  min-height: 12rem;
  overflow: auto;
  padding: var(--vav-space-2) var(--vav-space-6) var(--vav-space-6);
}

.palette-section-heading {
  align-items: center;
  display: flex;
  gap: var(--vav-space-4);
  justify-content: space-between;
  margin: var(--vav-space-3) 0;
}

.palette-section-heading h3 {
  font-size: var(--vav-font-size-sm);
  font-weight: 600;
  margin: 0;
}

.palette-section-heading span,
.palette-dialog__footer > span {
  color: var(--vav-color-text-muted);
  font-size: var(--vav-font-size-xs);
}

.palette-suggestions {
  display: grid;
  gap: var(--vav-space-2);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.palette-suggestions button {
  align-items: center;
  background: rgb(255 255 255 / 3%);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-md);
  color: var(--vav-color-text);
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: var(--vav-space-3);
  min-height: var(--vav-component-touch-target-minimum);
  padding: var(--vav-space-3);
  text-align: start;
}

.palette-suggestions button:hover {
  background: var(--vav-color-surface-soft);
  border-color: rgb(229 129 141 / 48%);
}

.palette-suggestions button span {
  color: var(--vav-color-action-primary);
}

.palette-results {
  display: grid;
  gap: var(--vav-space-2);
  list-style: none;
  margin: 0;
  padding: 0;
}

.palette-results a {
  align-items: center;
  border: 1px solid transparent;
  border-radius: var(--vav-radius-md);
  display: grid;
  gap: var(--vav-space-3);
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: var(--vav-space-3);
  text-decoration: none;
}

.palette-results a:hover {
  background: var(--vav-color-surface-soft);
  border-color: var(--vav-color-border);
}

.palette-result__marker {
  align-items: center;
  background: rgb(229 129 141 / 13%);
  border-radius: var(--vav-radius-sm);
  color: var(--vav-color-action-primary);
  display: inline-flex;
  height: 2.7rem;
  justify-content: center;
  width: 2.7rem;
}

.palette-result__copy {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.palette-result__copy small {
  color: var(--vav-color-action-primary);
  font-size: 0.65rem;
}

.palette-result__copy strong {
  font-size: var(--vav-font-size-sm);
}

.palette-result__copy > span:last-child {
  color: var(--vav-color-text-muted);
  font-size: var(--vav-font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-result__arrow {
  color: var(--vav-color-text-muted);
}

.palette-state {
  align-items: center;
  display: flex;
  gap: var(--vav-space-4);
  min-height: 10rem;
  padding: var(--vav-space-6);
}

.palette-state > span {
  align-items: center;
  border: 1px solid var(--vav-color-border);
  border-radius: 50%;
  color: var(--vav-color-action-primary);
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 1.25rem;
  height: 3.25rem;
  justify-content: center;
  width: 3.25rem;
}

.palette-state h3 {
  font-size: var(--vav-font-size-md);
  margin: 0 0 var(--vav-space-2);
}

.palette-state p {
  color: var(--vav-color-text-muted);
  font-size: var(--vav-font-size-sm);
  line-height: var(--vav-line-height-normal);
  margin: 0;
}

.palette-state button {
  background: transparent;
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-pill);
  color: var(--vav-color-text);
  cursor: pointer;
  font: inherit;
  margin-top: var(--vav-space-3);
  min-height: var(--vav-component-touch-target-minimum);
  padding-inline: var(--vav-space-4);
}

.palette-loading {
  display: grid;
  gap: var(--vav-space-2);
}

.palette-loading > div {
  align-items: center;
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-md);
  display: grid;
  gap: var(--vav-space-3);
  grid-template-columns: auto 1fr;
  padding: var(--vav-space-3);
}

.palette-loading > div > i,
.palette-loading span i {
  animation: palette-pulse 1.2s ease-in-out infinite;
  background: var(--vav-color-surface-soft);
  border-radius: var(--vav-radius-pill);
  display: block;
}

.palette-loading > div > i {
  border-radius: var(--vav-radius-sm);
  height: 2.7rem;
  width: 2.7rem;
}

.palette-loading span {
  display: grid;
  gap: var(--vav-space-2);
}

.palette-loading span i {
  height: 0.7rem;
  width: 45%;
}

.palette-loading span i:last-child {
  width: 78%;
}

.palette-dialog__footer {
  align-items: center;
  background: rgb(255 255 255 / 2%);
  border-top: 1px solid var(--vav-color-border);
  display: flex;
  gap: var(--vav-space-4);
  justify-content: space-between;
  padding: var(--vav-space-4) var(--vav-space-6);
}

.palette-dialog__footer a {
  align-items: center;
  color: var(--vav-color-action-primary);
  display: inline-flex;
  font-size: var(--vav-font-size-sm);
  gap: var(--vav-space-2);
  text-decoration: none;
}

@keyframes palette-pulse {
  50% {
    opacity: 0.45;
  }
}

@media (max-width: 62rem) {
  .palette-trigger {
    justify-content: space-between;
    width: 100%;
  }
}

@media (max-width: 36rem) {
  .palette-dialog {
    border-radius: var(--vav-radius-lg);
    margin-block: 1rem auto;
    max-height: calc(100dvh - 2rem);
  }

  .palette-dialog__header,
  .palette-dialog > .vav-search-box,
  .palette-dialog__body,
  .palette-dialog__footer {
    padding-inline: var(--vav-space-4);
  }

  .palette-suggestions {
    grid-template-columns: 1fr;
  }

  .palette-dialog__heading p,
  .palette-dialog__footer > span {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .palette-trigger,
  .palette-loading > div > i,
  .palette-loading span i {
    animation: none;
    transition: none;
  }
}
</style>
