import { defineConfig } from "vitest/config";

process.loadEnvFile(".env.test");

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
