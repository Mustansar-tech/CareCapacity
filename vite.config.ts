import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core dependencies that must be in critical path
          if (id.includes('react') && !id.includes('react-')) {
            return 'react-vendor';
          }
          if (id.includes('@radix-ui/react-dialog') || id.includes('@radix-ui/react-tabs') || id.includes('@radix-ui/react-select')) {
            return 'ui-vendor';
          }
          if (id.includes('@tanstack/react-query')) {
            return 'query';
          }
          // Defer non-critical features to separate chunks
          if (id.includes('recharts')) {
            return 'charts';
          }
          if (id.includes('leaflet') || id.includes('react-leaflet')) {
            return 'maps';
          }
          if (id.includes('framer-motion')) {
            return 'animations';
          }
          if (id.includes('scheduling-engine') || id.includes('scheduling-scoring')) {
            return 'scheduling';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
