<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  modelValue?: string;
  inputId?: string;
  label?: string;
  formLabel?: string;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  compact?: boolean;
  autocomplete?: string;
}>(), {
  modelValue: "",
  inputId: "vav-search",
  label: "搜索",
  formLabel: "全站搜索",
  placeholder: "输入搜索关键词",
  hint: "",
  submitLabel: "搜索",
  busyLabel: "搜索中",
  busy: false,
  disabled: false,
  compact: false,
  autocomplete: "off"
});

const emit = defineEmits<{
  search: [query: string];
  "update:modelValue": [query: string];
  clear: [];
}>();

const input = ref<HTMLInputElement>();
const query = ref(props.modelValue);
const hintId = computed(() => `${props.inputId}-hint`);
const submitDisabled = computed(() => props.busy || props.disabled || !query.value.trim());

watch(() => props.modelValue, (value) => {
  if (value !== query.value) query.value = value;
});

function updateQuery(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  emit("update:modelValue", query.value);
}

function submit() {
  if (submitDisabled.value) return;
  emit("search", query.value.trim());
}

async function clear() {
  query.value = "";
  emit("update:modelValue", "");
  emit("clear");
  await nextTick();
  input.value?.focus();
}

function focus() {
  input.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <form
    :class="['vav-search-box', { 'vav-search-box--compact': compact }]"
    role="search"
    :aria-label="formLabel"
    :aria-busy="busy"
    @submit.prevent="submit"
  >
    <label :for="inputId">{{ label }}</label>
    <div class="vav-search-box__control">
      <span
        class="vav-search-box__icon"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            cx="10.75"
            cy="10.75"
            r="6.25"
          />
          <path d="m15.5 15.5 4 4" />
        </svg>
      </span>
      <input
        :id="inputId"
        ref="input"
        :value="query"
        type="search"
        name="q"
        inputmode="search"
        enterkeyhint="search"
        maxlength="200"
        :autocomplete="autocomplete"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-describedby="hint ? hintId : undefined"
        @input="updateQuery"
      >
      <button
        v-if="query"
        class="vav-search-box__clear"
        type="button"
        aria-label="清除搜索关键词"
        :disabled="disabled"
        @click="clear"
      >
        <span aria-hidden="true">×</span>
      </button>
      <button
        class="vav-search-box__submit"
        type="submit"
        :disabled="submitDisabled"
      >
        <span
          v-if="busy"
          class="vav-search-box__spinner"
          aria-hidden="true"
        />
        {{ busy ? busyLabel : submitLabel }}
      </button>
    </div>
    <p
      v-if="hint"
      :id="hintId"
      class="vav-search-box__hint"
    >
      {{ hint }}
    </p>
  </form>
</template>

<style scoped>
.vav-search-box {
  display: grid;
  gap: var(--vav-space-3);
}

.vav-search-box > label {
  color: var(--vav-color-text);
  font-size: var(--vav-font-size-sm);
  font-weight: 650;
}

.vav-search-box__control {
  align-items: center;
  background: color-mix(in srgb, var(--vav-color-surface-raised) 88%, transparent);
  border: 1px solid var(--vav-color-border);
  border-radius: var(--vav-radius-pill);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%);
  display: grid;
  gap: var(--vav-space-2);
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  min-height: 4rem;
  padding: var(--vav-space-2);
  transition: border-color var(--vav-motion-duration-fast) var(--vav-motion-easing-standard),
    box-shadow var(--vav-motion-duration-fast) var(--vav-motion-easing-standard),
    background var(--vav-motion-duration-fast) var(--vav-motion-easing-standard);
}

.vav-search-box__control:focus-within {
  background: var(--vav-color-surface-raised);
  border-color: var(--vav-color-focus);
  box-shadow: var(--vav-shadow-focus);
}

.vav-search-box__icon {
  align-items: center;
  color: var(--vav-color-text-muted);
  display: inline-flex;
  justify-content: center;
  margin-inline-start: var(--vav-space-3);
}

.vav-search-box__icon svg {
  height: 1.4rem;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-width: 1.7;
  width: 1.4rem;
}

.vav-search-box input {
  background: transparent;
  border: 0;
  border-radius: 0;
  color: var(--vav-color-text);
  font: inherit;
  min-height: var(--vav-component-touch-target-minimum);
  min-width: 0;
  outline: 0;
  padding: 0 var(--vav-space-2);
  width: 100%;
}

.vav-search-box input::-webkit-search-cancel-button {
  appearance: none;
}

.vav-search-box input::placeholder {
  color: var(--vav-color-text-muted);
  opacity: 0.72;
}

.vav-search-box button {
  font: inherit;
}

.vav-search-box__clear {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--vav-radius-pill);
  color: var(--vav-color-text-muted);
  cursor: pointer;
  display: inline-flex;
  font-size: 1.35rem;
  height: var(--vav-component-touch-target-minimum);
  justify-content: center;
  width: var(--vav-component-touch-target-minimum);
}

.vav-search-box__clear:hover {
  background: var(--vav-color-surface-soft);
  color: var(--vav-color-text);
}

.vav-search-box__submit {
  align-items: center;
  background: var(--vav-color-action-primary);
  border: 1px solid transparent;
  border-radius: var(--vav-radius-pill);
  color: var(--vav-color-on-action);
  cursor: pointer;
  display: inline-flex;
  font-weight: 650;
  gap: var(--vav-space-2);
  justify-content: center;
  min-height: var(--vav-component-touch-target-minimum);
  min-width: 6rem;
  padding-inline: var(--vav-space-4);
  transition: background var(--vav-motion-duration-fast) var(--vav-motion-easing-standard),
    transform var(--vav-motion-duration-fast) var(--vav-motion-easing-standard);
}

.vav-search-box__submit:hover:not(:disabled) {
  background: var(--vav-color-action-primary-hover);
  transform: translateY(-1px);
}

.vav-search-box__submit:disabled,
.vav-search-box__clear:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.vav-search-box__hint {
  color: var(--vav-color-text-muted);
  font-size: var(--vav-font-size-xs);
  line-height: var(--vav-line-height-normal);
  margin: 0;
}

.vav-search-box__spinner {
  animation: vav-search-spin 0.8s linear infinite;
  border: 2px solid currentcolor;
  border-inline-end-color: transparent;
  border-radius: 50%;
  height: 1rem;
  width: 1rem;
}

.vav-search-box--compact {
  gap: var(--vav-space-2);
}

.vav-search-box--compact .vav-search-box__control {
  min-height: 3.35rem;
}

.vav-search-box--compact .vav-search-box__submit {
  min-width: 5.25rem;
}

@keyframes vav-search-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 36rem) {
  .vav-search-box__control {
    border-radius: var(--vav-radius-lg);
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .vav-search-box__submit {
    grid-column: 1 / -1;
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .vav-search-box__control,
  .vav-search-box__submit {
    transition: none;
  }
}
</style>
