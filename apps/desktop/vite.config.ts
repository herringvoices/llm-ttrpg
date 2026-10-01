import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@llm-ttrpg/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
      "@llm-ttrpg/reference-game": fileURLToPath(
        new URL("../../packages/reference-game/src/index.ts", import.meta.url),
      ),
    },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13" },
});
