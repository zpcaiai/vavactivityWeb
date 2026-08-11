import { localizeRoute } from "@vav/navigation-contracts";

import type { ExperienceRow } from "@/features/experience/api";

const authenticatedRoutePaths: Record<string, string> = {
  "user.home": "/{locale}/",
  "user.account": "/{locale}/account",
  "user.experience-home": "/{locale}/account/home",
  "user.tasks": "/{locale}/account/tasks",
  "user.journeys": "/{locale}/account/journeys",
  "user.search": "/{locale}/search",
  "user.help": "/{locale}/help",
  "user.activities": "/{locale}/activities",
  "user.courses": "/{locale}/courses",
  "user.counseling": "/{locale}/counseling",
  "user.ai": "/{locale}/ai-assistant",
  "user.dating-profile": "/{locale}/account/dating-profile",
  "user.recommendations": "/{locale}/recommendations",
  "user.matchmaking": "/{locale}/account/matchmaking/matches",
  "user.relationships": "/{locale}/account/relationships",
  "user.membership": "/{locale}/account/membership",
  "user.safety": "/{locale}/account/safety",
  "user.privacy": "/{locale}/account/privacy",
  "user.login": "/{locale}/auth/login"
};

const publicRouteOverrides: Record<string, string> = {
  "user.membership": "/{locale}/membership",
  "user.safety": "/{locale}/safety-support"
};

const categoryLabels: Record<string, string> = {
  activities: "活动",
  courses: "课程",
  counseling: "辅导",
  memberships: "会员",
  trust_safety: "安全支持",
  commerce: "订单与支付",
  content: "内容",
  knowledge: "帮助内容",
  experience: "服务导航"
};

export interface SearchResultPresentation {
  title: string;
  summary: string;
  category: string;
  marker: string;
}

export function resolveSearchDestination(
  row: ExperienceRow,
  locale: string,
  authenticated: boolean
) {
  const raw = String(
    row.route_path
      ?? row.route_code
      ?? row.action_route_code
      ?? row.fallback_route_code
      ?? ""
  );
  const routePath = (!authenticated && publicRouteOverrides[raw])
    || authenticatedRoutePaths[raw]
    || raw;

  if (!routePath.startsWith("/")) return `/${encodeURIComponent(locale)}/search`;
  return localizeRoute(routePath, locale);
}

export function presentSearchResult(row: ExperienceRow): SearchResultPresentation {
  const category = categoryLabels[String(row.source_module ?? "")] ?? "全站内容";
  const title = String(row.title ?? row.document_code ?? "未命名结果");
  const summary = String(row.summary ?? "打开查看当前可用内容与下一步。");
  return {
    title,
    summary,
    category,
    marker: category.slice(0, 1)
  };
}
