<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { useAuthStore } from "@/stores/auth";

const props = defineProps<{ mode: "login" | "register" }>();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();
const locale = computed(() => String(route.params.locale));
const title = computed(() =>
  props.mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")
);
const email = ref(String(route.query.email ?? ""));
const password = ref("");
const accepted = ref(false);
const busy = ref(false);
const error = ref("");
const complete = ref(false);
const registeredEmail = ref("");
const registrationRecipient = ref("");
const registrationRequiresVerification = ref(true);
const loginNeedsVerification = ref(false);
const resendBusy = ref(false);
const resendMessage = ref("");

function resetForm() {
  email.value = String(route.query.email ?? "");
  password.value = "";
  accepted.value = false;
  busy.value = false;
  error.value = "";
  complete.value = false;
  registeredEmail.value = "";
  registrationRecipient.value = "";
  registrationRequiresVerification.value = true;
  loginNeedsVerification.value = false;
  resendBusy.value = false;
  resendMessage.value = "";
}

async function submit() {
  busy.value = true;
  error.value = "";
  loginNeedsVerification.value = false;
  resendMessage.value = "";
  try {
    if (props.mode === "login") {
      await auth.login(email.value, password.value);
      await router.replace(`/${locale.value}/account/security`);
    } else {
      if (!accepted.value) {
        throw new Error("请先阅读并同意服务条款与隐私说明。");
      }
      const result = await auth.register({
        email: email.value,
        password: password.value,
        preferred_locale: locale.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        terms_version: "2026-07-01",
        privacy_version: "2026-07-01"
      });
      if (!["verification_required", "active"].includes(result.registration_status)) {
        throw new Error("注册状态无法确认，请稍后重试。");
      }
      registeredEmail.value = result.email;
      registrationRecipient.value = email.value;
      registrationRequiresVerification.value = (
        result.registration_status === "verification_required"
      );
      complete.value = true;
    }
  } catch (cause) {
    const code = (
      cause instanceof Error && "code" in cause ? String(cause.code) : ""
    );
    if (props.mode === "login" && code === "EMAIL_VERIFICATION_REQUIRED") {
      loginNeedsVerification.value = true;
      registrationRecipient.value = email.value;
      error.value = "邮箱尚未验证。请重新发送验证邮件，或稍后再试。";
    } else {
      error.value = cause instanceof Error ? cause.message : "请求失败，请稍后重试。";
    }
  } finally {
    busy.value = false;
  }
}

async function resendVerification() {
  if (!registrationRecipient.value || resendBusy.value) return;
  resendBusy.value = true;
  error.value = "";
  resendMessage.value = "";
  try {
    await auth.resendVerification(registrationRecipient.value);
    resendMessage.value = "验证邮件已重新发送，请检查收件箱和垃圾邮件目录。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "暂时无法重新发送验证邮件。";
  } finally {
    resendBusy.value = false;
  }
}

watch(() => props.mode, resetForm);
watch(() => route.query.email, (value) => {
  if (!complete.value) email.value = String(value ?? "");
});
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <span
        class="brand-mark"
        aria-hidden="true"
      >V</span>
      <p class="eyebrow">
        VAV ACCOUNT
      </p>
      <h1>{{ title }}</h1>
      <div
        v-if="complete"
        class="auth-success"
        role="status"
      >
        <span
          class="auth-success__icon"
          aria-hidden="true"
        >✓</span>
        <p class="eyebrow">
          REGISTRATION COMPLETE
        </p>
        <h2>
          {{ registrationRequiresVerification ? "注册成功，请验证邮箱" : "注册成功，可以登录" }}
        </h2>
        <p v-if="registrationRequiresVerification">
          账户已经创建，验证邮件已发送至 <strong>{{ registeredEmail }}</strong>。
          完成邮箱验证后即可登录。
        </p>
        <p v-else>
          账户 <strong>{{ registeredEmail }}</strong> 已创建，当前环境无需邮箱验证码。
          现在可以直接使用刚设置的密码登录。
        </p>
        <p
          v-if="registrationRequiresVerification"
          class="auth-success__hint"
        >
          验证链接仅可使用一次，并会在 24 小时后失效。
        </p>
        <p
          v-if="resendMessage"
          class="auth-success__notice"
          role="status"
        >
          {{ resendMessage }}
        </p>
        <p
          v-if="error"
          class="form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="auth-success__actions">
          <RouterLink
            class="primary-button"
            :to="{ path: `/${locale}/auth/login`, query: { email: registrationRecipient } }"
          >
            前往登录
          </RouterLink>
          <button
            v-if="registrationRequiresVerification"
            class="secondary-button"
            type="button"
            :disabled="resendBusy"
            @click="resendVerification"
          >
            {{ resendBusy ? "发送中…" : "重新发送验证邮件" }}
          </button>
        </div>
      </div>
      <form
        v-else
        class="auth-form"
        @submit.prevent="submit"
      >
        <label>
          {{ mode === "login" ? "邮箱或账号" : "邮箱" }}
          <input
            v-model.trim="email"
            :type="mode === 'login' ? 'text' : 'email'"
            :autocomplete="mode === 'login' ? 'username' : 'email'"
            required
          >
        </label>
        <label>
          密码
          <input
            v-model="password"
            type="password"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            :minlength="mode === 'register' ? 12 : undefined"
            maxlength="128"
            :aria-describedby="mode === 'register' ? 'registration-password-hint' : undefined"
            required
          >
        </label>
        <p
          v-if="mode === 'register'"
          id="registration-password-hint"
          class="auth-hint"
        >
          密码需为 12–128 位，请避免使用常见密码或邮箱地址。
        </p>
        <p
          v-if="mode === 'login'"
          class="auth-hint"
        >
          测试账号：test / test
        </p>
        <label
          v-if="mode === 'register'"
          class="checkbox-row"
        >
          <input
            v-model="accepted"
            type="checkbox"
          >
          我已阅读并同意服务条款与隐私说明
        </label>
        <p
          v-if="error"
          class="form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="resendMessage"
          class="auth-success__notice"
          role="status"
        >
          {{ resendMessage }}
        </p>
        <button
          v-if="loginNeedsVerification"
          class="secondary-button auth-form__resend"
          type="button"
          :disabled="resendBusy"
          @click="resendVerification"
        >
          {{ resendBusy ? "发送中…" : "重新发送验证邮件" }}
        </button>
        <button
          class="primary-button"
          type="submit"
          :disabled="busy"
        >
          {{ busy ? "处理中…" : title }}
        </button>
      </form>
      <nav
        v-if="!complete"
        class="auth-links"
      >
        <RouterLink
          v-if="mode === 'login'"
          :to="`/${locale}/auth/forgot-password`"
        >
          忘记密码
        </RouterLink>
        <RouterLink :to="`/${locale}/${mode === 'login' ? 'auth/register' : 'auth/login'}`">
          {{ mode === "login" ? "创建账户" : "已有账户，前往登录" }}
        </RouterLink>
      </nav>
    </div>
  </section>
</template>

<style scoped>
.auth-success {
  align-items: center;
  display: flex;
  flex-direction: column;
  margin-top: var(--vav-space-6);
}

.auth-success__icon {
  align-items: center;
  background: color-mix(in srgb, var(--vav-color-success) 18%, transparent);
  border: 1px solid var(--vav-color-success);
  border-radius: 50%;
  color: var(--vav-color-success);
  display: inline-flex;
  font-size: var(--vav-font-size-xl);
  height: 4rem;
  justify-content: center;
  margin-bottom: var(--vav-space-4);
  width: 4rem;
}

.auth-success h2 {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 500;
  margin: var(--vav-space-3) 0;
}

.auth-success > p:not(.eyebrow, .form-error, .auth-success__notice) {
  color: var(--vav-color-text-muted);
  line-height: var(--vav-line-height-relaxed);
  max-width: 34rem;
}

.auth-success__hint {
  font-size: var(--vav-font-size-sm);
}

.auth-success__notice {
  color: var(--vav-color-success);
  font-weight: 600;
}

.auth-success__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vav-space-3);
  justify-content: center;
  margin-top: var(--vav-space-6);
}

.auth-success__actions .primary-button,
.auth-success__actions .secondary-button {
  align-items: center;
  border-radius: var(--vav-radius-pill);
  display: inline-flex;
  justify-content: center;
  margin: 0;
  min-height: var(--vav-component-touch-target-minimum);
  padding: var(--vav-space-3) var(--vav-space-6);
  text-decoration: none;
}

.secondary-button {
  background: transparent;
  border: 1px solid var(--vav-color-border);
  color: var(--vav-color-text);
  cursor: pointer;
  font: inherit;
}

.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.auth-form__resend {
  min-height: var(--vav-component-touch-target-minimum);
  width: 100%;
}

@media (max-width: 36rem) {
  .auth-success__actions,
  .auth-success__actions > * {
    width: 100%;
  }
}
</style>
