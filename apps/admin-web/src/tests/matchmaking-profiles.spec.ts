import { describe, expect, it } from "vitest";

import pageSource from "../pages/MatchmakingProfileManagementPage.vue?raw";

describe("matchmaking profile operations", () => {
  it("uses the governed review-case association for photo decisions", () => {
    expect(pageSource).toContain("row.review_case_id");
    expect(pageSource).toContain("matchmaking.photos.review");
    expect(pageSource).toContain("matchmaking.reviews.decide");
    expect(pageSource).not.toContain("window.prompt");
  });
});
