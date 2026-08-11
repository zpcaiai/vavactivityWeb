<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { VSkipLink } from "@vav/ui-core";

import {
  getNavigation,
  type PublicNavigationItem
} from "@/features/public-site/api/content";
import { useAuthStore } from "@/stores/auth";
import NotificationBell from "@/features/notifications/components/NotificationBell.vue";
import GlobalCommandPalette from "@/features/experience/components/GlobalCommandPalette.vue";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();
const menuOpen = ref(false);
const locale = computed(() => String(route.params.locale));
const configuredLinks = ref<PublicNavigationItem[]>([]);
const signingOut = ref(false);

const fallbackLinks = [
  { key: "home", path: "" },
  { key: "activities", path: "activities" },
  { key: "courses", path: "courses" },
  { key: "counseling", path: "counseling" },
  { key: "ai", path: "ai-assistant" }
] as const;

const routePaths: Record<string, string> = {
  home: "",
  about: "activities",
  services: "services",
  contact: "contact",
  articles: "articles",
  stories: "stories",
  activities: "activities",
  courses: "courses",
  counseling: "counseling",
  ai: "ai-assistant"
};

const visibleConfiguredLinks = computed(() =>
  configuredLinks.value.filter((item) => !item.required_auth || Boolean(auth.user))
);

function internalPath(item: PublicNavigationItem) {
  if (item.link_type === "content") {
    return `/${locale.value}/${item.target_slug ?? ""}`;
  }
  return `/${locale.value}/${routePaths[item.route_name ?? ""] ?? ""}`;
}

function navigationLabel(item: PublicNavigationItem) {
  return item.route_name === "about" ? t("nav.activities") : item.label;
}

async function loadNavigation() {
  try {
    configuredLinks.value = await getNavigation("main_navigation", locale.value);
  } catch {
    configuredLinks.value = [];
  }
}

async function logout() {
  if (signingOut.value) return;
  signingOut.value = true;
  menuOpen.value = false;
  try {
    await auth.logout();
  } catch {
    // Do not keep a bearer token in memory when the remote logout request fails.
    auth.clearSession();
  } finally {
    signingOut.value = false;
    await router.replace(`/${locale.value}/`);
  }
}

onMounted(() => void loadNavigation());
watch(locale, () => void loadNavigation());
watch(() => route.path, async () => {
  menuOpen.value = false;
  await nextTick();
  const heading = document.querySelector<HTMLElement>("#main-content h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
});
</script>

<template>
  <div :class="['site-shell', { 'home-route': route.name === 'home' }]">
    <VSkipLink />
    <header class="site-header">
      <RouterLink
        class="brand"
        :to="`/${locale}/`"
        aria-label="VAV home"
      >
        <strong class="brand-wordmark">VAV</strong>
        <small>{{ t("brand.promise") }}</small>
      </RouterLink>

      <button
        class="menu-button"
        type="button"
        :aria-label="t('nav.menu')"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span />
        <span />
      </button>

      <nav
        :class="['main-nav', { open: menuOpen }]"
        aria-label="Primary"
      >
        <template v-if="visibleConfiguredLinks.length">
          <template
            v-for="link in visibleConfiguredLinks"
            :key="link.id"
          >
            <a
              v-if="link.link_type === 'external'"
              :href="link.external_url ?? '#'"
              :target="link.open_in_new_tab ? '_blank' : undefined"
              :rel="link.open_in_new_tab ? 'noopener noreferrer' : undefined"
              @click="menuOpen = false"
            >
              {{ navigationLabel(link) }}
            </a>
            <RouterLink
              v-else
              :to="internalPath(link)"
              @click="menuOpen = false"
            >
              {{ navigationLabel(link) }}
            </RouterLink>
          </template>
        </template>
        <template v-else>
          <RouterLink
            v-for="link in fallbackLinks"
            :key="link.key"
            :to="`/${locale}/${link.path}`"
            @click="menuOpen = false"
          >
            {{ t(`nav.${link.key}`) }}
          </RouterLink>
        </template>
        <RouterLink
          class="cart-link"
          :to="`/${locale}/cart`"
          @click="menuOpen = false"
        >
          {{ t("commerce.cart") }}
        </RouterLink>
        <NotificationBell v-if="auth.user" />
        <GlobalCommandPalette />
        <RouterLink
          class="start-link"
          :to="auth.user ? `/${locale}/account` : `/${locale}/auth/register`"
          @click="menuOpen = false"
        >
          {{ auth.user ? t("nav.account") : t("nav.start") }}
          <span aria-hidden="true">↗</span>
        </RouterLink>
        <RouterLink
          class="language-link"
          to="/"
          @click="menuOpen = false"
        >
          {{ t("common.language") }}
        </RouterLink>
        <button
          v-if="auth.user"
          class="logout-link"
          type="button"
          :disabled="signingOut"
          @click="logout"
        >
          {{ signingOut ? t("nav.signingOut") : t("nav.logout") }}
        </button>
      </nav>
    </header>

    <main id="main-content">
      <RouterView />
    </main>

    <footer class="site-footer">
      <div>
        <span
          class="brand-mark small"
          aria-hidden="true"
        >V</span>
        <strong>VAV</strong>
      </div>
      <p>{{ t("brand.promise") }} · © 2026</p>
      <RouterLink :to="`/${locale}/about`">
        {{ t("nav.about") }}
      </RouterLink>
      <RouterLink :to="`/${locale}/privacy`">
        隐私说明
      </RouterLink>
      <RouterLink
        v-if="auth.user"
        :to="`/${locale}/account/privacy`"
      >
        隐私中心
      </RouterLink>
      <RouterLink
        v-if="auth.user"
        :to="`/${locale}/account/tasks`"
      >
        任务中心
      </RouterLink>
      <RouterLink :to="`/${locale}/help`">
        帮助中心
      </RouterLink>
      <RouterLink :to="`/${locale}/account/orders`">
        {{ t("commerce.orders") }}
      </RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.logout-link {
  background: transparent;
  border: 0;
  color: rgb(239 245 248 / 72%);
  cursor: pointer;
  font: inherit;
  font-size: var(--vav-font-size-sm);
  padding: 0;
}

.logout-link:hover:not(:disabled) {
  color: var(--vav-color-action-primary);
}

.logout-link:disabled {
  cursor: wait;
  opacity: 0.6;
}

@media (max-width: 62rem) {
  .logout-link {
    justify-self: stretch;
    min-height: var(--vav-component-touch-target-minimum);
    text-align: start;
    width: 100%;
  }
}
</style>
