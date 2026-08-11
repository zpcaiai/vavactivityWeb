<script setup lang="ts">
import { ref } from "vue";

import { catalogApi } from "@/features/catalog/api";

const form = ref({
  skuId: "",
  quantity: 1,
  currency: "USD",
  region: "",
  segment: "",
  coupon: ""
});
const result = ref<Record<string, unknown> | null>(null);
const error = ref("");

async function simulate() {
  error.value = "";
  try {
    result.value = await catalogApi("/admin/catalog/pricing/simulate", {
      method: "POST",
      body: JSON.stringify({
        sku_id: form.value.skuId,
        quantity: form.value.quantity,
        requested_currency: form.value.currency,
        coupon_code: form.value.coupon || null,
        pricing_context: {
          region_code: form.value.region || null,
          customer_segment: form.value.segment || null,
          requested_at: new Date().toISOString(),
          channel: "admin"
        }
      })
    });
  } catch (cause) {
    result.value = null;
    error.value = cause instanceof Error ? cause.message : "模拟失败";
  }
}
</script>

<template>
  <section>
    <header class="page-toolbar">
      <div>
        <p class="admin-kicker">
          确定性定价
        </p>
        <h2>定价模拟器</h2>
      </div>
    </header>
    <div class="editor-form simulation-form">
      <label>SKU 唯一标识<el-input v-model="form.skuId" /></label>
      <label>数量<el-input v-model.number="form.quantity" /></label>
      <label>币种<el-select v-model="form.currency">
        <el-option
          label="人民币（CNY）"
          value="CNY"
        />
        <el-option
          label="美元（USD）"
          value="USD"
        />
        <el-option
          label="新台币（TWD）"
          value="TWD"
        />
        <el-option
          label="港币（HKD）"
          value="HKD"
        />
      </el-select></label>
      <label>地区<el-input v-model="form.region" /></label>
      <label>用户分组<el-input v-model="form.segment" /></label>
      <label>优惠码<el-input v-model="form.coupon" /></label>
      <el-button
        type="primary"
        @click="simulate"
      >
        运行无副作用模拟
      </el-button>
    </div>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    />
    <pre
      v-if="result"
      class="simulation-result"
    >{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
