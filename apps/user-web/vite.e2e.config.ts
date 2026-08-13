import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "./vite.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      hmr: false,
      watch: {
        // E2E runs must exercise one immutable frontend snapshot. Concurrent
        // source edits must not reload a form halfway through an auth request.
        ignored: ["**/*"]
      }
    }
  })
);
