<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";

import { activityApi, type PublicActivity } from "../api";

const route = useRoute();
const { t } = useI18n();
const activities = ref<PublicActivity[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    activities.value = (await activityApi.list(String(route.params.locale))).items;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("activities.loadError");
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(() => route.params.locale, () => void load());
</script>

<template>
  <section class="catalog-page activity-page">
    <header class="catalog-heading">
      <div>
        <p class="eyebrow">
          {{ t("activities.eyebrow") }}
        </p>
        <h1>{{ t("activities.title") }}</h1>
        <p>{{ t("activities.privacyBoundary") }}</p>
      </div>
    </header>
    <p
      v-if="loading"
      role="status"
    >
      {{ t("activities.loading") }}
    </p>
    <p
      v-else-if="error"
      class="form-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-else
      class="product-grid content-card-grid"
    >
      <article
        v-for="activity in activities"
        :key="activity.id"
        class="product-card content-card activity-card"
      >
        <div class="product-card-body content-card-body">
          <p class="eyebrow content-card-kicker">
            {{ activity.format }} · {{ activity.status }}
          </p>
          <h2 class="content-card-title">
            {{ activity.title }}
          </h2>
          <p
            v-if="activity.summary"
            class="content-card-summary"
          >
            {{ activity.summary }}
          </p>
          <footer class="content-card-footer">
            <time
              class="content-card-meta"
              :datetime="activity.starts_at"
            >
              {{ new Date(activity.starts_at).toLocaleString() }}
              <span>{{ activity.timezone }}</span>
            </time>
            <RouterLink
              class="text-link content-card-link"
              :to="`/${String(route.params.locale)}/activities/${activity.slug}`"
            >
              {{ t("activities.view") }}
              <span aria-hidden="true">→</span>
            </RouterLink>
          </footer>
        </div>
      </article>
    </div>
  </section>
</template>
