import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pagesDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../pages");
const pageSources = readdirSync(pagesDirectory)
  .filter((name) => name.endsWith(".vue"))
  .map((name) => ({ name, source: readFileSync(`${pagesDirectory}/${name}`, "utf8") }));

describe("admin page localization contract", () => {
  it("keeps every page kicker and eyebrow title in Chinese", () => {
    for (const page of pageSources) {
      const headings = page.source.matchAll(
        /<p[^>]*class="(?:admin-kicker|eyebrow)"[^>]*>([\s\S]*?)<\/p>/gu,
      );
      for (const heading of headings) {
        expect(heading[1], `${page.name} contains a non-Chinese page title`).toMatch(/[\u3400-\u9fff]/u);
      }
    }
  });

  it("does not allow English-only static form, table, or dialog titles", () => {
    for (const page of pageSources) {
      const attributes = page.source.matchAll(/(?:^|\s)(?:label|title|caption)="([^"]+)"/gmu);
      for (const attribute of attributes) {
        expect(attribute[1], `${page.name} contains an English-only title: ${attribute[1]}`).toMatch(
          /[\u3400-\u9fff]/u,
        );
      }
    }
  });

  it("formats direct date columns in UTC+8", () => {
    for (const page of pageSources) {
      const columns = page.source.matchAll(/<el-table-column[\s\S]*?\/>/gu);
      for (const column of columns) {
        if (!/prop="[a-z_]*(?:_at|_date|_from|_until)"/u.test(column[0])) continue;
        expect(column[0], `${page.name} has an unformatted date column`).toContain(
          ':formatter="formatAdminTableCell"',
        );
        expect(column[0], `${page.name} date title does not declare UTC+8`).toContain("UTC+8");
      }
    }
  });

  it("does not expose raw API keys as dynamic table titles", () => {
    for (const page of pageSources) {
      expect(page.source, `${page.name} exposes raw API keys`).not.toMatch(/:label="(?:key|column)"/u);
    }
  });
});
