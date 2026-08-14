<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { VSkipLink } from "@vav/ui-core";

import GlobalCommandPalette from "@/features/experience/components/GlobalCommandPalette.vue";
import NotificationBell from "@/features/notifications/components/NotificationBell.vue";
import { useAppNavigation } from "@/composables/useAppNavigation";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const { t } = useI18n();
const auth = useAuthStore();
const { publicLinks, localePath } = useAppNavigation();

const menuOpen = ref(false);

const footerGroups = computed(() => [
  {
    key: "services",
    label: t("footer.services"),
    links: [
      { label: t("ia.public.activities"), to: localePath("activities") },
      { label: t("ia.public.courses"), to: localePath("courses") },
      { label: t("ia.public.counseling"), to: localePath("counseling") },
      { label: t("ia.public.membership"), to: localePath("membership") }
    ]
  },
  {
    key: "about",
    label: t("footer.about"),
    links: [
      { label: t("ia.public.about"), to: localePath("about") },
      { label: t("ia.public.stories"), to: localePath("stories") },
      { label: t("ia.public.articles"), to: localePath("articles") },
      { label: t("footer.contact"), to: localePath("contact") }
    ]
  },
  {
    key: "trust",
    label: t("footer.trust"),
    links: [
      { label: t("footer.privacy"), to: localePath("privacy") },
      { label: t("footer.terms"), to: localePath("terms") },
      { label: t("footer.refund"), to: localePath("refund-policy") },
      { label: t("footer.aiDisclaimer"), to: localePath("ai-disclaimer") },
      { label: t("footer.safety"), to: localePath("safety-support") }
    ]
  },
  {
    key: "support",
    label: t("footer.support"),
    links: [
      { label: t("footer.help"), to: localePath("help") },
      { label: t("footer.search"), to: localePath("search") }
    ]
  }
]);

watch(
  () => route.fullPath,
  async () => {
    menuOpen.value = false;
    await nextTick();
    const heading = document.querySelector<HTMLElement>("#main-content h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
);
</script>

<template>
  <div :class="['site-shell', { 'home-route': route.name === 'home' }]">
    <VSkipLink />

    <header class="site-header">
      <RouterLink
        class="site-header__brand"
        :to="localePath('')"
        aria-label="VAV"
      >
        <span
          class="site-header__mark"
          aria-hidden="true"
        >V</span>
        <span class="site-header__wordmark">
          <strong>VAV</strong>
          <small>{{ t("brand.promise") }}</small>
        </span>
      </RouterLink>

      <button
        class="site-header__menu"
        type="button"
        :aria-label="t('nav.menu')"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>

      <nav
        :class="['site-nav', { open: menuOpen }]"
        :aria-label="t('nav.primary')"
      >
        <template
          v-for="link in publicLinks"
          :key="link.key"
        >
          <RouterLink
            :to="link.to"
            @click="menuOpen = false"
          >
            {{ link.label }}
          </RouterLink>
        </template>
      </nav>

      <div class="site-header__actions">
        <GlobalCommandPalette />
        <RouterLink
          class="site-header__cart"
          :to="localePath('cart')"
        >
          {{ t("commerce.cart") }}
        </RouterLink>
        <NotificationBell v-if="auth.user" />
        <RouterLink
          class="site-header__cta"
          :to="auth.user ? localePath('account/home') : localePath('auth/register')"
        >
          {{ auth.user ? t("shell.memberSpace") : t("nav.start") }}
          <span aria-hidden="true">↗</span>
        </RouterLink>
        <RouterLink
          class="site-header__language"
          to="/"
        >
          {{ t("common.language") }}
        </RouterLink>
      </div>
    </header>

    <main id="main-content">
      <RouterView />
    </main>

    <footer class="site-footer">
      <div class="site-footer__brand">
        <span
          class="site-header__mark"
          aria-hidden="true"
        >V</span>
        <div>
          <strong>VAV</strong>
          <p>{{ t("brand.promise") }}</p>
        </div>
      </div>

      <div class="site-footer__groups">
        <section
          v-for="group in footerGroups"
          :key="group.key"
        >
          <h2>{{ group.label }}</h2>
          <ul>
            <li
              v-for="link in group.links"
              :key="link.to"
            >
              <RouterLink :to="link.to">
                {{ link.label }}
              </RouterLink>
            </li>
          </ul>
        </section>
      </div>

      <p class="site-footer__legal">
        © 2026 VAV · {{ t("footer.legal") }}
      </p>
    </footer>
  </div>
</template>
