import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@llm-ttrpg/engine": fileURLToPath(
        new URL("./packages/engine/src/index.ts", import.meta.url),
      ),
      "@llm-ttrpg/harness": fileURLToPath(
        new URL("./packages/harness/src/index.ts", import.meta.url),
      ),
      "@llm-ttrpg/reference-game": fileURLToPath(
        new URL("./packages/reference-game/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
