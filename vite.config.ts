import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __TEST_WITNESS_EXTENSION_VERSION__: JSON.stringify("0.1.1"),
  },
  build: {
    target: "chrome116",
    minify: "oxc",
    sourcemap: true,
  },
});
