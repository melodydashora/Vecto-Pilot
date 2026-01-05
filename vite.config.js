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
      chunkSizeWarningLimit: 1200, // Main chunk ~1.12MB due to React+charts in same chunk
      // 2026-01-05: Feature-based code splitting for optimal caching
      rollupOptions: {
        output: {
          // 2026-01-05: Conservative chunking to avoid React dependency issues
          // Only split packages that are truly independent (no React deps)
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // UI components - independent from each other
              if (id.includes('@radix-ui') || id.includes('lucide-react')) {
                return 'vendor-ui';
              }
              // CSS utilities - no dependencies
              if (id.includes('tailwind-merge') || id.includes('class-variance-authority') || id.includes('clsx')) {
                return 'vendor-css';
              }
              // Let Rollup handle React, charts, and everything else naturally
              // This prevents forwardRef errors from chunk load ordering issues
            }
          }
        }
      }
    },
  };
});