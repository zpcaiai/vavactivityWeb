<script setup lang="ts">
import {
  DataAnalysis,
  Document,
  Goods,
  House,
  Lock,
  Setting,
  User
} from "@element-plus/icons-vue";
import { computed, nextTick, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { VSkipLink } from "@vav/ui-core";

import { adminLocales, type AdminLocale, useAdminLocale } from "@/i18n";
import { useAdminAuthStore } from "@/stores/admin-auth";

const route = useRoute();
const router = useRouter();
const auth = useAdminAuthStore();
const { locale, setLocale, t } = useAdminLocale();
const collapsed = ref(false);
const mobileNavigationOpen = ref(false);
const mobileNavigationButton = ref<HTMLButtonElement | null>(null);
const mobileNavigationClose = ref<HTMLButtonElement | null>(null);
const navigationQuery = ref("");
const signingOut = ref(false);
const pageTitle = computed(() => String(route.meta.title ?? "工作台"));

const menu = [
  { path: "/admin/dashboard", labelKey: "menu.dashboard", icon: House },
  { path: "/admin/users", labelKey: "menu.users", icon: User },
  { path: "/admin/content/pages", labelKey: "menu.pages", icon: Document },
  { path: "/admin/content/media", labelKey: "menu.media", icon: Document },
  { path: "/admin/content/navigation", labelKey: "menu.navigation", icon: Document },
  { path: "/admin/catalog/products", labelKey: "menu.catalog", icon: Goods },
  { path: "/admin/commerce/orders", labelKey: "menu.commerce", icon: Goods },
  { path: "/admin/activities", labelKey: "menu.activities", icon: Goods },
  { path: "/admin/courses", labelKey: "menu.courses", icon: Document },
  { path: "/admin/counseling", labelKey: "menu.counseling", icon: User },
  { path: "/admin/knowledge", labelKey: "menu.knowledge", icon: Document },
  { path: "/admin/ai", labelKey: "menu.ai", icon: DataAnalysis },
  { path: "/admin/notifications/dashboard", labelKey: "menu.notifications", icon: Document },
  { path: "/admin/privacy/dashboard", labelKey: "menu.privacy", icon: Lock },
  { path: "/admin/matchmaking/profiles", labelKey: "menu.matchmaking", icon: User },
  { path: "/admin/recommendations/dashboard", labelKey: "menu.recommendations", icon: DataAnalysis },
  { path: "/admin/matchmaking-interactions/dashboard", labelKey: "menu.interactions", icon: User },
  { path: "/admin/relationships/dashboard", labelKey: "menu.relationships", icon: User },
  { path: "/admin/memberships/dashboard", labelKey: "menu.memberships", icon: Goods },
  { path: "/admin/trust-safety/reports", labelKey: "menu.trustSafety", icon: Lock },
  { path: "/admin/system/status", labelKey: "menu.system", icon: Setting },
  { path: "/admin/skills/dashboard", labelKey: "menu.skills", icon: DataAnalysis },
  { path: "/admin/quality/dashboard", labelKey: "menu.quality", icon: DataAnalysis },
  { path: "/admin/design-system/dashboard", labelKey: "menu.designSystem", icon: DataAnalysis },
  { path: "/admin/experience/dashboard", labelKey: "menu.experience", icon: DataAnalysis },
  { path: "/admin/processes/dashboard", labelKey: "menu.processes", icon: DataAnalysis },
  { path: "/admin/data-governance/dashboard", labelKey: "menu.dataGovernance", icon: DataAnalysis },
  { path: "/admin/content/settings", labelKey: "menu.settings", icon: Setting },
  { path: "/admin/access/admins", labelKey: "menu.admins", icon: Lock },
  { path: "/admin/audit/auth", labelKey: "menu.audit", icon: DataAnalysis }
];
const visibleMenu = computed(() => {
  const notificationLanding = [
    ["notifications.analytics.read", "dashboard"],
    ["notifications.templates.read", "templates"],
    ["notifications.deliveries.read", "deliveries"],
    ["notifications.campaigns.read", "campaigns"],
    ["notifications.reminders.read", "reminders"],
    ["notifications.providers.read", "providers"],
    ["notifications.audit.read", "audit"]
  ].find(([permission]) => auth.hasPermission(permission))?.[1];
  const permittedItems = menu.map((item) => item.path === "/admin/notifications/dashboard" && notificationLanding
    ? { ...item, path: `/admin/notifications/${notificationLanding}` }
    : item).filter((item) => {
    const permissionByPath: Record<string, string> = {
      "/admin/users": "users.read",
      "/admin/content/pages": "content.pages.read",
      "/admin/content/media": "content.media.read",
      "/admin/content/navigation": "content.navigation.read",
      "/admin/catalog/products": "catalog.products.read",
      "/admin/commerce/orders": "commerce.orders.read",
      "/admin/activities": "activities.read",
      "/admin/courses": "courses.read",
      "/admin/counseling": "counseling.appointments.read",
      "/admin/knowledge": "knowledge.spaces.read",
      "/admin/ai": "ai.conversations.read",
      "/admin/notifications/dashboard": "notifications.analytics.read",
      "/admin/privacy/dashboard": "privacy.requests.read",
      "/admin/matchmaking/profiles": "matchmaking.profiles.read",
      "/admin/recommendations/dashboard": "recommendations.analytics.read",
      "/admin/matchmaking-interactions/dashboard": "matchmaking.analytics.read",
      "/admin/relationships/dashboard": "relationships.analytics.read",
      "/admin/memberships/dashboard": "memberships.analytics.read",
      "/admin/trust-safety/reports": "safety.reports.read",
      "/admin/system/status": "system.status.read",
      "/admin/skills/dashboard": "skills.analytics.read",
      "/admin/quality/dashboard": "quality.analytics.read",
      "/admin/design-system/dashboard": "design.analytics.read",
      "/admin/experience/dashboard": "experience.analytics.read",
      "/admin/processes/dashboard": "process.dashboard.read",
      "/admin/data-governance/dashboard": "data.dashboard.read",
      "/admin/platform/dashboard": "admin.workbench.read",
      "/admin/content/settings": "content.settings.read",
      "/admin/access/admins": "admins.read",
      "/admin/audit/auth": "audit.read"
    };
    if (item.labelKey === "menu.notifications") {
      return Boolean(notificationLanding);
    }
    const required = permissionByPath[item.path];
    return !required || auth.hasPermission(required);
  });
  const query = navigationQuery.value.trim().toLocaleLowerCase(locale.value);
  if (!query) {
    return permittedItems;
  }
  return permittedItems.filter((item) =>
    t(item.labelKey).toLocaleLowerCase(locale.value).includes(query)
  );
});

function changeLocale(value: string) {
  if (adminLocales.includes(value as AdminLocale)) {
    setLocale(value as AdminLocale);
  }
}

async function logout() {
  signingOut.value = true;
  try {
    await auth.logout();
  } catch {
    // Never retain a bearer token locally merely because the network failed.
    auth.clearSession();
  } finally {
    signingOut.value = false;
    await router.replace({ name: "admin-login" });
  }
}

watchEffect(() => {
  document.documentElement.lang = locale.value;
});
watch(mobileNavigationOpen, async (open) => {
  await nextTick();
  if (open) {
    mobileNavigationClose.value?.focus();
  } else {
    mobileNavigationButton.value?.focus();
  }
});
watch(() => route.fullPath, async () => {
  mobileNavigationOpen.value = false;
  await nextTick();
  const heading = document.querySelector<HTMLElement>("#admin-main h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
});
</script>

<template>
  <div class="admin-shell">
    <VSkipLink target="admin-main" />
    <button
      v-if="mobileNavigationOpen"
      class="navigation-backdrop"
      type="button"
      :aria-label="t('shell.closeNavigation')"
      @click="mobileNavigationOpen = false"
    />
    <aside
      id="admin-navigation"
      :class="['admin-sidebar', { collapsed, 'mobile-open': mobileNavigationOpen }]"
      :aria-label="t('shell.navigation')"
      @keydown.esc="mobileNavigationOpen = false"
    >
      <div class="admin-brand">
        <span
          class="brand-mark"
          aria-hidden="true"
        >V</span>
        <div v-if="!collapsed || mobileNavigationOpen">
          <strong>VAV</strong>
          <small>{{ t("shell.workspace") }}</small>
        </div>
        <button
          ref="mobileNavigationClose"
          class="mobile-navigation-close"
          type="button"
          :aria-label="t('shell.closeNavigation')"
          @click="mobileNavigationOpen = false"
        >
          ×
        </button>
      </div>
      <label
        v-if="!collapsed || mobileNavigationOpen"
        class="navigation-search"
      >
        <span class="visually-hidden">{{ t("shell.searchNavigation") }}</span>
        <input
          v-model="navigationQuery"
          type="search"
          :placeholder="t('shell.searchNavigation')"
        >
      </label>
      <nav :aria-label="t('shell.navigation')">
        <el-menu
          :default-active="route.path"
          router
          :collapse="collapsed && !mobileNavigationOpen"
        >
          <el-menu-item
            v-for="item in visibleMenu"
            :key="item.path"
            :index="item.path"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>
              {{ t(item.labelKey) }}
            </template>
          </el-menu-item>
        </el-menu>
        <p
          v-if="!collapsed && visibleMenu.length === 0"
          class="navigation-empty"
          role="status"
        >
          {{ t("shell.noNavigationResults") }}
        </p>
      </nav>
      <button
        class="collapse-button"
        type="button"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? t("shell.expand") : t("shell.collapse") }}
      </button>
    </aside>

    <section class="admin-content">
      <header class="admin-header">
        <div class="admin-heading">
          <button
            ref="mobileNavigationButton"
            class="mobile-navigation-open"
            type="button"
            aria-controls="admin-navigation"
            :aria-expanded="mobileNavigationOpen"
            :aria-label="t('shell.openNavigation')"
            @click="mobileNavigationOpen = true"
          >
            ☰
          </button>
          <div>
            <p class="admin-kicker">
              {{ t("shell.operations") }}
            </p>
            <h1>{{ pageTitle }}</h1>
          </div>
        </div>
        <div class="operator-actions">
          <label class="admin-locale-select">
            <span>{{ t("shell.language") }}</span>
            <el-select
              data-testid="admin-locale-select"
              :model-value="locale"
              size="small"
              @change="changeLocale"
            >
              <el-option
                label="简体中文"
                value="zh-CN"
              />
              <el-option
                label="繁體中文"
                value="zh-TW"
              />
              <el-option
                label="英文"
                value="en"
              />
            </el-select>
          </label>
          <div class="operator-chip">
            <span class="status-dot" />
            <div>
              <strong>{{ auth.user?.email }}</strong>
              <small>{{ t("shell.authorizedSession") }}</small>
            </div>
          </div>
          <el-button
            type="danger"
            plain
            :loading="signingOut"
            @click="logout"
          >
            {{ signingOut ? t("shell.signingOut") : t("shell.logout") }}
          </el-button>
        </div>
      </header>
      <main
        id="admin-main"
        class="admin-main"
      >
        <RouterView />
      </main>
    </section>
  </div>
</template>
