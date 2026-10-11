import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // GitHub project Pages are served below /yahoocompanion/. Keep the local
  // development server at / so `npm.cmd run dev` remains conventional.
  base: command === "build" ? "/yahoocompanion/" : "/",
  plugins: [react()],
  publicDir: "data/processed",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
