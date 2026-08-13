<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { commerceApi, type Order } from "@/features/commerce/api";
import ActivityPaymentPanel from "../components/ActivityPaymentPanel.vue";
import {
  activityApi,
  type ActivityRegistration,
  type ActivityWaitlistEntry
} from "../api";

const rows = ref<ActivityRegistration[]>([]);
const { t } = useI18n();
const error = ref("");
const credential = ref("");
const waitlist = ref<ActivityWaitlistEntry[]>([]);
const busy = ref("");
const ordersById = ref(new Map<string, Order>());

function orderFor(orderId: string): Order {
  return ordersById.value.get(orderId)!;
}

async function load() {
  try {
    const [registrationResult, waitlistResult] = await Promise.all([
      activityApi.registrations(),
      activityApi.waitlist()
    ]);
    rows.value = registrationResult.items;
    waitlist.value = waitlistResult.items;
    try {
      const orders = await commerceApi.orders();
      ordersById.value = new Map(orders.items.map((order) => [order.id, order]));
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : t("activities.paymentOrderUnavailable");
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "报名记录加载失败";
  }
}

async function cancel(row: ActivityRegistration) {
  busy.value = row.id;
  try {
    await activityApi.cancelRegistration(row.id, "User cancelled from the activity account page.");
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "取消失败";
  } finally {
    busy.value = "";
  }
}

async function accept(entry: ActivityWaitlistEntry) {
  busy.value = entry.id;
  try {
    await activityApi.acceptWaitlist(entry.id);
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "接受候补邀请失败";
  } finally {
    busy.value = "";
  }
}

async function issue(activityId: string) {
  try {
    credential.value = (await activityApi.credential(activityId)).token;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "签到凭证生成失败";
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="commerce-page">
    <p class="eyebrow">
      MY VAV
    </p>
    <h1>{{ t("activities.myRegistrations") }}</h1>
    <p>{{ t("activities.entitlementBoundary") }}</p>
    <p
      v-if="error"
      class="form-error"
    >
      {{ error }}
    </p>
    <article
      v-for="row in rows"
      :key="row.id"
      class="commerce-card"
    >
      <div>
        <strong>{{ row.registration_number }}</strong>
        <small>{{ row.status }} · {{ row.attendance_status }}</small>
      </div>
      <RouterLink
        v-if="row.order_id"
        :to="{ name: 'account-orders' }"
      >
        {{ t("activities.orders") }}
      </RouterLink>
      <ActivityPaymentPanel
        v-if="row.order_id && ordersById.get(row.order_id)"
        :order="orderFor(row.order_id)"
        :registration-id="row.id"
      />
      <button
        v-if="row.status === 'confirmed'"
        type="button"
        @click="issue(row.activity_id)"
      >
        {{ t("activities.checkinPass") }}
      </button>
      <RouterLink
        v-if="row.status === 'confirmed'"
        :to="{ name: 'activity-experience', params: { activityId: row.activity_id } }"
      >
        {{ t("activities.experience") }}
      </RouterLink>
      <button
        v-if="!['cancelled', 'rejected', 'expired'].includes(row.status)"
        type="button"
        :disabled="busy === row.id"
        @click="cancel(row)"
      >
        {{ t("activities.cancel") }}
      </button>
    </article>
    <h2>{{ t("activities.waitlistStatus") }}</h2>
    <article
      v-for="entry in waitlist"
      :key="entry.id"
      class="commerce-card"
    >
      <div>
        <strong>#{{ entry.sequence_number }} · {{ entry.status }}</strong>
        <small v-if="entry.promotion_offer_expires_at">
          邀请有效至 {{ new Date(entry.promotion_offer_expires_at).toLocaleString() }}
        </small>
      </div>
      <button
        v-if="entry.status === 'promotion_offered'"
        type="button"
        :disabled="busy === entry.id"
        @click="accept(entry)"
      >
        {{ t("activities.acceptPromotion") }}
      </button>
    </article>
    <RouterLink :to="{ name: 'activity-matches' }">
      {{ t("activities.matches") }}
    </RouterLink>
    <p
      v-if="credential"
      class="commerce-card"
    >
      短时签到凭证：<code>{{ credential }}</code>
    </p>
  </section>
</template>
