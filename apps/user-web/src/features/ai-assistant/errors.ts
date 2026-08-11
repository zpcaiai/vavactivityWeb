import { AiAssistantApiError } from "./api";

const disabledMessages: Record<string, string> = {
  "zh-CN": "哈拿老师 AI 辅导正在启动或维护中，请稍后重试。",
  "zh-TW": "哈拿老師 AI 輔導正在啟動或維護中，請稍後重試。",
  en: "Hanna AI coaching is starting or under maintenance. Please try again shortly."
};

export function isAiAssistantDisabled(cause: unknown): boolean {
  return cause instanceof AiAssistantApiError && cause.code === "AI_ASSISTANT_DISABLED";
}

export function aiAssistantErrorMessage(
  cause: unknown,
  locale: string,
  fallback: string
): string {
  if (isAiAssistantDisabled(cause)) {
    return disabledMessages[locale] ?? disabledMessages["zh-CN"];
  }
  return cause instanceof Error ? cause.message : fallback;
}
