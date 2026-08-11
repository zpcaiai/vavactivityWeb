import { describe, expect, it } from "vitest";

import { AiAssistantApiError, createAiAssistantApiError } from "./api";
import {
  aiAssistantErrorMessage,
  isAiAssistantDisabled,
  isAiAssistantUnavailable
} from "./errors";

describe("AI assistant API errors", () => {
  it("preserves the backend error code and status", () => {
    const error = createAiAssistantApiError(503, {
      error: {
        code: "AI_ASSISTANT_DISABLED",
        message: "The AI assistant is not enabled."
      }
    });

    expect(error).toBeInstanceOf(AiAssistantApiError);
    expect(error.code).toBe("AI_ASSISTANT_DISABLED");
    expect(error.status).toBe(503);
  });

  it.each([
    ["zh-CN", "哈拿老师 AI 辅导正在启动或维护中，请稍后重试。"],
    ["zh-TW", "哈拿老師 AI 輔導正在啟動或維護中，請稍後重試。"],
    ["en", "Hanna AI coaching is starting or under maintenance. Please try again shortly."]
  ])("localizes the disabled message for %s", (locale, expected) => {
    const error = new AiAssistantApiError(
      "AI_ASSISTANT_DISABLED",
      "The AI assistant is not enabled.",
      503
    );

    expect(isAiAssistantDisabled(error)).toBe(true);
    expect(aiAssistantErrorMessage(error, locale, "fallback")).toBe(expected);
  });

  it("keeps non-disabled API messages intact", () => {
    const error = new AiAssistantApiError("AUTHENTICATION_REQUIRED", "Please sign in.", 401);

    expect(isAiAssistantDisabled(error)).toBe(false);
    expect(aiAssistantErrorMessage(error, "zh-CN", "fallback")).toBe("Please sign in.");
  });

  it.each(["AI_PROVIDER_NOT_CONFIGURED", "AI_PROVIDER_UNAVAILABLE"])(
    "localizes provider error %s",
    (code) => {
      const error = new AiAssistantApiError(code, "upstream message", 503);

      expect(aiAssistantErrorMessage(error, "zh-CN", "fallback")).toBe(
        "哈拿老师 AI 对话服务暂时不可用，请稍后重试。"
      );
      expect(isAiAssistantUnavailable(error)).toBe(code === "AI_PROVIDER_NOT_CONFIGURED");
    }
  );

  it("localizes Gemini safety blocks", () => {
    const error = new AiAssistantApiError(
      "AI_PROVIDER_CONTENT_BLOCKED",
      "upstream message",
      422
    );

    expect(aiAssistantErrorMessage(error, "zh-TW", "fallback")).toBe(
      "這項請求無法由 AI 安全回答，你可以換一種方式描述，或選擇真人支援。"
    );
  });
});
