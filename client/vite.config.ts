import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    // Increase warning limit - heavy deps like Charts/Maps are expected
    chunkSizeWarningLimit: 1000,
    // Updated 2026-01-05: Feature-based code splitting for optimal caching
    // See: https://vite.dev/guide/build.html#chunking-strategy
    rollupOptions: {
      output: {
        manualChunks(id) {
          // NOTE: This config is NOT used - see root /vite.config.js
          // Kept for reference only
          if (id.includes('node_modules')) {
            // --- Group 1: React Core (Stable) ---
            // Changes rarely, cached long-term. Includes react, react-dom, router, query
            if (
              id.includes('react') ||
              id.includes('react-dom') ||
              id.includes('react-router') ||
              id.includes('@tanstack')
            ) {
              return 'vendor-react-core';
            }

            // --- Group 2: UI & Design System (Medium Frequency) ---
            // 25+ @radix-ui packages grouped to prevent dozens of tiny HTTP requests
            if (
              id.includes('@radix-ui') ||
              id.includes('lucide-react') ||
              id.includes('class-variance-authority') ||
              id.includes('tailwind-merge')
            ) {
              return 'vendor-ui';
            }

            // --- Group 3: Data Visualization (Heavy) ---
            // Recharts and Chart.js are large; isolate so pages without charts load fast
            if (id.includes('recharts') || id.includes('chart.js') || id.includes('d3')) {
              return 'vendor-charts';
            }

            // --- Group 4: Maps (Heavy) ---
            if (id.includes('@googlemaps')) {
              return 'vendor-maps';
            }

            // --- Group 5: Form & Validation (Lightweight) ---
            if (id.includes('react-hook-form') || id.includes('zod') || id.includes('drizzle-zod')) {
              return 'vendor-forms';
            }

            // --- Default: Everything else from node_modules ---
            return 'vendor-utils';
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    hmr: {
      port: 24679
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "/",
});