<script setup lang="ts">
import type { CatalogSku } from "../types";

const props = defineProps<{
  modelValue: string;
  skus: CatalogSku[];
  productType?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const chineseText = /[\u3400-\u9fff]/u;
const unitNames: Record<string, string> = {
  access: "份权益",
  course: "门课程",
  day: "天",
  item: "份",
  month: "个月",
  seat: "个名额",
  session: "次服务"
};

function configuredName(sku: CatalogSku) {
  const nameKeys = [
    "display_name_zh",
    "label_zh",
    "name_zh",
    "title_zh",
    "display_name",
    "label",
    "name",
    "title"
  ];
  for (const key of nameKeys) {
    const value = sku.entitlement_definition[key];
    if (typeof value === "string" && chineseText.test(value.trim())) {
      return value.trim();
    }
  }
  return "";
}

function displayName(sku: CatalogSku) {
  const configured = configuredName(sku);
  if (configured) return configured;

  const context = `${props.productType ?? ""}_${sku.sku_code}`.toUpperCase();
  if (/(AI_ASSIST|AI_COACH|AI_SERVICE)/u.test(context)) return "AI 辅导";
  if (/COURSE/u.test(context)) return "课程学习";
  if (/(COUNSEL|COACH|MENTOR)/u.test(context)) return "辅导服务";
  if (/(ACTIVITY|EVENT|TICKET)/u.test(context)) return "活动参与";
  if (/(MEMBER|SUBSCRIPTION|PLAN)/u.test(context)) return "会员权益";
  if (/(DIGITAL|DOWNLOAD|CONTENT)/u.test(context)) return "数字内容";
  if (sku.billing_type === "recurring") return "订阅服务";
  if (sku.billing_type === "free") return "免费使用";
  return props.skus.length > 1
    ? `方案 ${props.skus.indexOf(sku) + 1}`
    : "标准方案";
}

function serviceQuantity(sku: CatalogSku) {
  if (!sku.service_quantity) return "";
  const unit = unitNames[String(sku.service_unit ?? "").toLowerCase()] ?? "份";
  return `${sku.service_quantity} ${unit}`;
}
</script>

<template>
  <fieldset class="sku-selector">
    <legend>选择方案</legend>
    <label
      v-for="sku in skus"
      :key="sku.id"
      :class="{ selected: sku.id === modelValue }"
    >
      <input
        type="radio"
        name="sku"
        :value="sku.id"
        :checked="sku.id === modelValue"
        @change="emit('update:modelValue', sku.id)"
      >
      <span>
        <strong>{{ displayName(sku) }}</strong>
        <small v-if="serviceQuantity(sku)">
          {{ serviceQuantity(sku) }}
        </small>
      </span>
    </label>
  </fieldset>
</template>
