import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __TEST_WITNESS_EXTENSION_VERSION__: JSON.stringify("0.1.0-test"),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
