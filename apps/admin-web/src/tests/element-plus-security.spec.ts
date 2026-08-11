import { describe, expect, it } from "vitest";

const adminVueSources = import.meta.glob<string>("../**/*.vue", {
  eager: true,
  import: "default",
  query: "?raw"
});
const mainSource = import.meta.glob<string>("../main.ts", {
  eager: true,
  import: "default",
  query: "?raw"
})["../main.ts"];

describe("Element Plus security boundary", () => {
  it("does not use the vulnerable el-link href surface", () => {
    for (const [path, source] of Object.entries(adminVueSources)) {
      expect(source, path).not.toMatch(/<el-link\b/iu);
    }
  });

  it("registers the card component used by governed metric pages", () => {
    expect(mainSource).toMatch(/ElCard/u);
    expect(mainSource).toMatch(/element-plus\/es\/components\/card\/style\/css/u);
  });
});
