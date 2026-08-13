<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { commerceApi, type Order } from "@/features/commerce/api";

const props = defineProps<{
  order: Order;
  registrationId?: string;
}>();

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const busy = ref(false);
const error = ref("");
const providers = computed(() => props.order.available_payment_providers ?? []);
const provider = ref(providers.value[0] ?? "");
const payable = computed(() =>
  ["pending_payment", "payment_failed"].includes(props.order.status)
);
const processing = computed(() => props.order.status === "payment_processing");
const titleId = computed(() => `activity-payment-title-${props.order.id}`);
const amount = computed(() =>
  new Intl.NumberFormat(String(route.params.locale || "zh-CN"), {
    style: "currency",
    currency: props.order.currency
  }).format(props.order.total_minor / 100)
);

watch(
  () => [props.order.id, ...providers.value],
  () => {
    if (!providers.value.includes(provider.value)) {
      provider.value = providers.value[0] ?? "";
    }
  }
);

function providerLabel(value: string) {
  return ({ stripe: "Stripe", paypal: "PayPal" } as Record<string, string>)[value]
    ?? value;
}

async function pay() {
  if (!payable.value || !provider.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const payment = await commerceApi.createPayment(
      props.order.order_number,
      provider.value,
      `activity-payment-${crypto.randomUUID()}`
    );
    sessionStorage.setItem(
      `vav_payment_${props.order.order_number}`,
      JSON.stringify(payment)
    );
    await router.push({
      name: "checkout-processing",
      params: { locale: String(route.params.locale) },
      query: {
        order: props.order.order_number,
        ...(props.registrationId ? { registration: props.registrationId } : {})
      }
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("commerce.error");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    v-if="order.total_minor > 0"
    class="activity-payment-panel"
    :aria-labelledby="titleId"
  >
    <div>
      <p class="eyebrow">
        {{ t("activities.paymentRequired") }}
      </p>
      <h3 :id="titleId">
        {{ t("activities.amountDue") }}：{{ amount }}
      </h3>
      <p>{{ t("activities.paymentConfirmationBoundary") }}</p>
    </div>

    <div
      v-if="payable"
      class="activity-payment-actions"
    >
      <label v-if="providers.length">
        <span>{{ t("commerce.provider") }}</span>
        <select v-model="provider">
          <option
            v-for="item in providers"
            :key="item"
            :value="item"
          >
            {{ providerLabel(item) }}
          </option>
        </select>
      </label>
      <button
        class="primary-button"
        type="button"
        :disabled="busy || !provider"
        @click="pay"
      >
        {{ busy ? t("activities.creatingPayment") : t("activities.payNow") }}
      </button>
      <p
        v-if="!providers.length"
        class="form-error"
        role="alert"
      >
        {{ t("activities.paymentUnavailable") }}
      </p>
    </div>

    <RouterLink
      v-else-if="processing"
      class="primary-button"
      :to="{
        name: 'checkout-processing',
        params: { locale: String(route.params.locale) },
        query: { order: order.order_number, registration: registrationId }
      }"
    >
      {{ t("activities.resumePayment") }}
    </RouterLink>

    <p
      v-if="error"
      class="form-error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.activity-payment-panel {
  display: grid;
  gap: 1.25rem;
  margin-top: 1.25rem;
  padding: clamp(1.25rem, 2.5vw, 1.75rem);
  border: 1px solid color-mix(in srgb, var(--vav-color-accent) 58%, transparent);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--vav-color-surface-raised) 94%, white 6%);
}

.activity-payment-panel h3,
.activity-payment-panel p {
  margin: 0;
}

.activity-payment-panel > div:first-child {
  display: grid;
  gap: 0.55rem;
}

.activity-payment-actions {
  display: grid;
  grid-template-columns: minmax(12rem, 1fr) auto;
  align-items: end;
  gap: 0.85rem;
}

.activity-payment-actions label {
  display: grid;
  gap: 0.45rem;
}

.activity-payment-actions .form-error {
  grid-column: 1 / -1;
}

@media (max-width: 40rem) {
  .activity-payment-actions {
    grid-template-columns: 1fr;
  }
}
</style>
