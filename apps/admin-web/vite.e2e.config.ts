import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "./vite.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      hmr: false,
      watch: {
        ignored: ["**/*"]
      }
    }
  })
);
