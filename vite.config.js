import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => {
  let runtimeErrorOverlay;
  try {
    const mod = await import("@replit/vite-plugin-runtime-error-modal");
    runtimeErrorOverlay = mod.default || mod;
  } catch (error) {
    runtimeErrorOverlay = null;
  }

  const projectRoot = process.cwd();

  return {
    base: '/',
    root: path.resolve(projectRoot, "client"),
    plugins: [
      react(),
      ...(runtimeErrorOverlay ? [runtimeErrorOverlay()] : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "client", "src"),
        "@shared": path.resolve(projectRoot, "shared"),
        "@assets": path.resolve(projectRoot, "client", "src", "assets"),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: '0.0.0.0',
    },
    build: {
      outDir: path.resolve(projectRoot, "client", "dist"),
      emptyOutDir: true,
      sourcemap: false,
      // Increase warning limit - heavy deps like Charts/Maps are expected
      chunkSizeWarningLimit: 1000,
      // 2026-01-05: Feature-based code splitting for optimal caching
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // Group 1: React Core (Stable) - cached long-term
              if (
                id.includes('react') ||
                id.includes('react-dom') ||
                id.includes('react-router') ||
                id.includes('@tanstack')
              ) {
                return 'vendor-react-core';
              }
              // Group 2: UI & Design System - 25+ @radix-ui packages
              if (
                id.includes('@radix-ui') ||
                id.includes('lucide-react') ||
                id.includes('class-variance-authority') ||
                id.includes('tailwind-merge')
              ) {
                return 'vendor-ui';
              }
              // Group 3: Data Visualization (Heavy)
              if (id.includes('recharts') || id.includes('chart.js') || id.includes('d3')) {
                return 'vendor-charts';
              }
              // Group 4: Maps (Heavy)
              if (id.includes('@googlemaps')) {
                return 'vendor-maps';
              }
              // Group 5: Form & Validation
              if (id.includes('react-hook-form') || id.includes('zod') || id.includes('drizzle-zod')) {
                return 'vendor-forms';
              }
              // Default: Everything else from node_modules
              return 'vendor-utils';
            }
          }
        }
      }
    },
  };
});