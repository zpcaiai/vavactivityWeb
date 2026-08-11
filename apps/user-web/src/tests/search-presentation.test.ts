import { describe, expect, it } from "vitest";

import {
  presentSearchResult,
  resolveSearchDestination
} from "@/features/experience/search-presentation";

describe("search result presentation", () => {
  it("routes backend route_code results instead of falling back to the search page", () => {
    expect(resolveSearchDestination({ route_code: "user.activities" }, "zh-CN", false))
      .toBe("/zh-CN/activities");
    expect(resolveSearchDestination({ route_code: "user.tasks" }, "en", true))
      .toBe("/en/account/tasks");
  });

  it("keeps public search results on public membership and safety pages", () => {
    expect(resolveSearchDestination({ route_code: "user.membership" }, "zh-TW", false))
      .toBe("/zh-TW/membership");
    expect(resolveSearchDestination({ route_code: "user.safety" }, "zh-CN", false))
      .toBe("/zh-CN/safety-support");
  });

  it("localizes route_path results and safely contains unknown route codes", () => {
    expect(resolveSearchDestination({ route_path: "/{locale}/courses" }, "en", false))
      .toBe("/en/courses");
    expect(resolveSearchDestination({ route_code: "unknown.route" }, "zh-CN", false))
      .toBe("/zh-CN/search");
  });

  it("maps backend metadata to concise result copy", () => {
    expect(presentSearchResult({
      title: "课程",
      summary: "查看课程与学习服务",
      source_module: "courses"
    })).toEqual({
      title: "课程",
      summary: "查看课程与学习服务",
      category: "课程",
      marker: "课"
    });
  });
});
