import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ASSERTED_DIMENSIONS,
  DERIVED_DIMENSIONS,
  certificationStatus,
  deriveDimension,
  parseCsv
} from "@/features/usability/api";
import { usabilitySectionPermissions } from "@/navigation/admin-nav";

const srcDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(path: string) {
  return readFileSync(resolve(srcDirectory, path), "utf8");
}

function locale(name: string) {
  return JSON.parse(source(`i18n/locales/${name}.json`)) as {
    menu: Record<string, string>;
    section: Record<string, string>;
  };
}

describe("split-frontend usability wiring", () => {
  it("labels and routes every declared frontend section", () => {
    const locales = ["zh-CN", "zh-TW", "en"].map(locale);
    for (const messages of locales) {
      expect(messages.menu.usability).toBeTruthy();
      for (const key of Object.keys(usabilitySectionPermissions)) {
        expect(messages.section[key]).toBeTruthy();
      }
    }
    expect(source("navigation/admin-nav.ts")).toContain('base: "/admin/usability"');
    expect(source("router/index.ts")).toContain("usabilitySection: section");
    expect(source("router/index.ts")).toContain("UsabilityManagementPage");
  });

  it("does not pretend this split repository proves backend route parity", () => {
    // Backend PERMISSIONS parity is tested in the backend repository. This test
    // intentionally reads no services/api path and proves frontend wiring only.
    expect(source("features/usability/api.ts")).not.toContain("services/api");
    expect(source("navigation/admin-nav.ts")).not.toContain("readFileSync");
  });
});

describe("usability evidence handling", () => {
  it("keeps derivable and operator-asserted dimensions separate", () => {
    expect(DERIVED_DIMENSIONS).toEqual(["uat", "compatibility", "localization"]);
    expect(ASSERTED_DIMENSIONS).toEqual(["draft", "notification", "import_export"]);
  });

  it("aggregates certification evidence fail-closed", () => {
    const passing = {
      uat: "passed",
      compatibility: "passed",
      localization: "passed",
      draft: "passed",
      notification: "passed",
      import_export: "passed"
    };
    expect(certificationStatus(passing, 0)).toBe("certified");
    expect(certificationStatus(passing, 1)).toBe("rejected");
    expect(certificationStatus({ ...passing, uat: "not_run" }, 0)).toBe("eligible");
    expect(certificationStatus({ ...passing, uat: "in_progress" }, 0)).toBe("rejected");
  });

  it("never counts an unfinished run as a pass", () => {
    const rows = [
      { release_version: "1.2.0", environment: "staging", status: "passed" },
      { release_version: "1.2.0", environment: "staging", status: "running" }
    ];
    expect(deriveDimension(rows, "1.2.0", "staging").status).toBe("not_run");
  });

  it("requires evidence for asserted passes and previews the verdict", () => {
    const page = source("pages/UsabilityManagementPage.vue");
    expect(page).toContain("assertedPassWithoutEvidence");
    expect(page).toContain(
      'asserted: { draft: "not_run", notification: "not_run", import_export: "not_run" }'
    );
    expect(page).toContain("certPreview");
  });
});

describe("usability input boundaries", () => {
  it("parses quoted CSV without splitting embedded commas or newlines", () => {
    const rows = parseCsv(
      'email,note\r\n"a@example.test","hello, world"\r\n"b@example.test","line\nbreak"\r\n'
    );
    expect(rows).toEqual([
      { email: "a@example.test", note: "hello, world" },
      { email: "b@example.test", note: "line\nbreak" }
    ]);
  });

  it("states that import preview does not commit data", () => {
    const page = source("pages/UsabilityManagementPage.vue");
    expect(page).toContain("不会把数据写进业务表");
    expect(page).toContain("dry_run: true");
  });

  it("keeps user draft autosave out of the operator console", () => {
    expect(source("features/usability/api.ts")).not.toContain("saveDraft");
    expect(source("pages/UsabilityManagementPage.vue")).not.toContain("client_version");
    expect(source("pages/UsabilityManagementPage.vue")).toContain("不是管理端可以代填的对象");
  });
});
