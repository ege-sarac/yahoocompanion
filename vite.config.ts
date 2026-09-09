import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "data/processed",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
