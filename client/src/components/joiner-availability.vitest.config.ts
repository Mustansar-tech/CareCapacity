import { transform } from "esbuild";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The app's tsconfig preserves JSX for Vite's React plugin; the base test
// configuration is node-only. Compile JSX explicitly for this focused UI suite.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, ".."),
      "@shared": resolve(import.meta.dirname, "../../../shared"),
    },
  },
  plugins: [{
    name: "availability-test-jsx",
    enforce: "pre",
    async transform(source, id) {
      if (!/\.[jt]sx$/.test(id)) return;
      return transform(source, { loader: "tsx", jsx: "automatic", sourcemap: "inline" });
    },
  }],
  test: {
    include: ["client/src/components/joiner-availability.ui-test.tsx"],
  },
});
