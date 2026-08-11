import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { explainApiConnectionError, resolveApiBaseUrl } from "@/config/api";

export interface AdminUser {
  id: string;
  email: string;
  status: string;
  email_verified: boolean;
  permissions: string[];
}

interface AuthResponse {
  data: {
    access_token: string;
    expires_in: number;
    user: AdminUser;
  };
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[];
  };
  detail?: ApiErrorDetail[];
  message?: string;
}

interface ApiErrorDetail {
  location?: unknown;
  loc?: unknown;
  message?: string;
  msg?: string;
  type?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "邮箱或密码错误，或该账户没有管理端权限",
  ADMIN_ACCESS_REQUIRED: "该账户的管理端权限已被移除，请联系平台管理员",
  RATE_LIMITED: "登录尝试过于频繁，请稍后再试",
  AUTH_SESSION_INVALID: "登录会话已失效，请重新登录",
  ORIGIN_NOT_ALLOWED: "当前站点来源未获后端授权"
};

const baseUrl = resolveApiBaseUrl();

function csrfToken() {
  const cookies = document.cookie.split("; ");
  for (const name of ["vav_admin_csrf", "vav_csrf"]) {
    const value = cookies
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split("=")
      .slice(1)
      .join("=");
    if (value) return value;
  }
  return undefined;
}

function isHtmlResponse(text: string, contentType: string | null): boolean {
  if (text.startsWith("<!DOCTYPE") || text.includes("<html")) {
    return true;
  }
  if (contentType?.includes("text/html")) {
    return true;
  }
  return false;
}

function humanizeAuthError(payload: ApiErrorPayload, fallback: string): string {
  const details = payload.error?.details ?? payload.detail;
  if (Array.isArray(details) && details.length > 0) {
    const detailMessages = details
      .map((row) => {
        const location = Array.isArray(row.location)
          ? row.location
          : Array.isArray(row.loc)
            ? row.loc
            : [];
        const field = location.at(-1);
        if (field === "email") {
          return "邮箱：请输入有效的邮箱地址";
        }
        const message = row.msg || row.message;
        return typeof message === "string" && message.trim().length > 0
          ? message.trim()
          : undefined;
      })
      .filter((value): value is string => Boolean(value));
    if (detailMessages.length > 0) {
      return detailMessages.join("; ");
    }
  }
  const code = payload.error?.code;
  if (code && AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
  }
  if (payload.error?.message?.trim()) {
    return payload.error.message.trim();
  }
  if (payload.message?.trim()) {
    return payload.message.trim();
  }
  return fallback;
}

export const useAccessStore = defineStore("access", () => {
  const accessToken = ref<string>();
  const accessTokenExpiresAt = ref(0);
  const permissions = ref<string[]>([]);
  const user = ref<AdminUser | null>(null);
  const status = ref<"unknown" | "authenticated" | "anonymous" | "refreshing">("unknown");
  let refreshPromise: Promise<boolean> | undefined;
  const isAuthenticated = computed(() => Boolean(accessToken.value));

  function hasPermission(required: string | string[]) {
    const requested = Array.isArray(required) ? required : [required];
    return requested.every((item) => permissions.value.includes(item));
  }

  function clearSession() {
    accessToken.value = undefined;
    accessTokenExpiresAt.value = 0;
    permissions.value = [];
    user.value = null;
    status.value = "anonymous";
  }

  async function requestAuth(path: string, init: RequestInit = {}) {
    const requestUrl = `${baseUrl}${path}`;
    const headers = new Headers(init.headers);
    if (init.body) {
      headers.set("Content-Type", "application/json");
    }
    let response: Response;
    try {
      response = await fetch(requestUrl, {
        ...init,
        credentials: "include",
        headers
      });
    } catch {
      throw new Error(explainApiConnectionError("管理员认证", baseUrl));
    }

    const text = await response.text();
    const contentType = response.headers.get("content-type");
    let result: (AuthResponse & ApiErrorPayload) | null = null;
    if (!isHtmlResponse(text, contentType) && text) {
      try {
        result = JSON.parse(text) as AuthResponse & ApiErrorPayload;
      } catch {
        if (!response.ok) {
          if (isHtmlResponse(text, contentType)) {
            throw new Error(`管理员认证失败：后端返回了非 JSON 响应，当前请求 ${requestUrl} 可能不是真正 API。`);
          }
          throw new Error(text);
        }
        throw new Error("管理员认证返回了无效响应");
      }
    } else if (isHtmlResponse(text, contentType)) {
      throw new Error(`管理员认证失败：后端返回了 HTML 响应，当前请求 ${requestUrl} 可能不是 API 域名。`);
    }
    if (!response.ok) {
      if (result && "error" in result && result.error?.message) {
        throw new Error(humanizeAuthError(result as ApiErrorPayload, result.error.message));
      }
      const fallback = text.trim() ? text : "管理员认证失败";
      throw new Error(result ? humanizeAuthError(result as ApiErrorPayload, fallback) : fallback);
    }
    if (!result) {
      throw new Error("管理员认证返回为空");
    }
    return result;
  }

  function applyAuth(result: AuthResponse) {
    accessToken.value = result.data.access_token;
    accessTokenExpiresAt.value = Date.now() + result.data.expires_in * 1_000;
    permissions.value = result.data.user.permissions;
    user.value = result.data.user;
    status.value = "authenticated";
  }

  async function login(email: string, password: string) {
    const normalizedEmail = email.trim();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      throw new Error("请输入有效的超级管理员邮箱");
    }
    if (!password) {
      throw new Error("请输入密码");
    }
    const result = await requestAuth("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: normalizedEmail,
        password,
        device_name: "Admin web browser"
      })
    });
    applyAuth(result);
  }

  async function refreshSession() {
    status.value = "refreshing";
    try {
      const csrf = csrfToken();
      if (!csrf) {
        clearSession();
        return false;
      }
      const result = await requestAuth("/admin/auth/refresh", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf }
      });
      applyAuth(result);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  async function refresh() {
    if (refreshPromise) {
      return refreshPromise;
    }
    refreshPromise = refreshSession();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = undefined;
    }
  }

  async function bootstrap() {
    if (status.value === "unknown" || status.value === "refreshing") {
      return refresh();
    }
    return isAuthenticated.value;
  }

  async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    await bootstrap();
    if (
      accessToken.value &&
      accessTokenExpiresAt.value > 0 &&
      Date.now() >= accessTokenExpiresAt.value - 30_000
    ) {
      await refresh();
    }
    const initialToken = accessToken.value;
    const execute = () => {
      const headers = new Headers(init.headers);
      if (accessToken.value) {
        headers.set("Authorization", `Bearer ${accessToken.value}`);
      } else {
        headers.delete("Authorization");
      }
      return fetch(input, { ...init, credentials: "include", headers });
    };

    let response = await execute();
    if (response.status !== 401) {
      return response;
    }
    if (accessToken.value === initialToken && !await refresh()) {
      return response;
    }
    if (!accessToken.value) return response;
    response = await execute();
    return response;
  }

  async function logout() {
    if (!accessToken.value) {
      clearSession();
      return;
    }
    const csrf = csrfToken();
    await requestAuth("/admin/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.value}`,
        ...(csrf ? { "X-CSRF-Token": csrf } : {})
      }
    });
    clearSession();
  }

  return {
    accessToken,
    permissions,
    user,
    status,
    isAuthenticated,
    hasPermission,
    login,
    refresh,
    bootstrap,
    authorizedFetch,
    logout,
    clearSession
  };
});
