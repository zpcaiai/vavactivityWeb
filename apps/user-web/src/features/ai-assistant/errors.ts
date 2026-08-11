import { AiAssistantApiError } from "./api";

const disabledMessages: Record<string, string> = {
  "zh-CN": "哈拿老师 AI 辅导正在启动或维护中，请稍后重试。",
  "zh-TW": "哈拿老師 AI 輔導正在啟動或維護中，請稍後重試。",
  en: "Hanna AI coaching is starting or under maintenance. Please try again shortly."
};

const providerUnavailableMessages: Record<string, string> = {
  "zh-CN": "哈拿老师 AI 对话服务暂时不可用，请稍后重试。",
  "zh-TW": "哈拿老師 AI 對話服務暫時無法使用，請稍後重試。",
  en: "Hanna AI conversation service is temporarily unavailable. Please try again shortly."
};

const contentBlockedMessages: Record<string, string> = {
  "zh-CN": "这项请求无法由 AI 安全回答，你可以换一种方式描述，或选择真人支持。",
  "zh-TW": "這項請求無法由 AI 安全回答，你可以換一種方式描述，或選擇真人支援。",
  en: "The AI cannot safely answer this request. Rephrase it or choose human support."
};

function localized(messages: Record<string, string>, locale: string): string {
  return messages[locale] ?? messages["zh-CN"];
}

export function isAiAssistantDisabled(cause: unknown): boolean {
  return cause instanceof AiAssistantApiError && cause.code === "AI_ASSISTANT_DISABLED";
}

export function isAiAssistantUnavailable(cause: unknown): boolean {
  return cause instanceof AiAssistantApiError && [
    "AI_ASSISTANT_DISABLED",
    "AI_PROVIDER_NOT_CONFIGURED"
  ].includes(cause.code);
}

export function aiAssistantErrorMessage(
  cause: unknown,
  locale: string,
  fallback: string
): string {
  if (isAiAssistantDisabled(cause)) {
    return localized(disabledMessages, locale);
  }
  if (cause instanceof AiAssistantApiError && cause.code === "AI_PROVIDER_CONTENT_BLOCKED") {
    return localized(contentBlockedMessages, locale);
  }
  if (cause instanceof AiAssistantApiError && [
    "AI_PROVIDER_NOT_CONFIGURED",
    "AI_PROVIDER_UNAVAILABLE"
  ].includes(cause.code)) {
    return localized(providerUnavailableMessages, locale);
  }
  return cause instanceof Error ? cause.message : fallback;
}
