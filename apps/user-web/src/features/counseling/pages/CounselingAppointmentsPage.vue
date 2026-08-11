<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { counselingApi, type CounselingAppointment } from "../api";

const route = useRoute();
const appointments = ref<CounselingAppointment[]>([]);
const detail = ref<CounselingAppointment>();
const error = ref("");

async function load() {
  try {
    if (route.params.appointmentId) {
      detail.value = await counselingApi.appointment(String(route.params.appointmentId));
    } else {
      appointments.value = (await counselingApi.appointments()).items;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "预约记录加载失败";
  }
}

async function cancel(id: string) {
  await counselingApi.cancel(id);
  await load();
}

onMounted(() => void load());
</script>

<template>
  <section class="content-page counseling-account">
    <h1>我的辅导预约</h1>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >
      {{ error }}
    </p>
    <article
      v-if="detail"
      class="product-card content-card content-card-body content-card--compact"
    >
      <p class="eyebrow content-card-kicker">
        {{ detail.status }}
      </p>
      <h2 class="content-card-title">
        {{ detail.appointment_number }}
      </h2>
      <p class="content-card-summary">
        会谈入口仅在预约窗口内签发，录音与转写默认关闭。
      </p>
      <footer class="content-card-footer">
        <time
          v-if="detail.scheduled_starts_at"
          class="content-card-meta"
          :datetime="detail.scheduled_starts_at"
        >
          {{ new Date(detail.scheduled_starts_at).toLocaleString() }}
        </time>
        <button
          v-if="detail.status === 'confirmed'"
          type="button"
          @click="cancel(detail.id)"
        >
          取消预约
        </button>
      </footer>
    </article>
    <div
      v-else
      class="product-grid content-card-grid"
    >
      <article
        v-for="appointment in appointments"
        :key="appointment.id"
        class="product-card content-card content-card-body content-card--compact"
      >
        <p class="eyebrow content-card-kicker">
          {{ appointment.status }}
        </p>
        <h2 class="content-card-title">
          {{ appointment.appointment_number }}
        </h2>
        <footer class="content-card-footer">
          <time
            v-if="appointment.scheduled_starts_at"
            class="content-card-meta"
            :datetime="appointment.scheduled_starts_at"
          >
            {{ new Date(appointment.scheduled_starts_at).toLocaleString() }}
          </time>
          <RouterLink
            class="text-link content-card-link"
            :to="`/${String(route.params.locale)}/account/counseling/${appointment.id}`"
          >
            查看预约
            <span aria-hidden="true">→</span>
          </RouterLink>
        </footer>
      </article>
    </div>
  </section>
</template>
