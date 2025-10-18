
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const projectRoot = process.cwd();

export default defineConfig({
    plugins: [
        react(),
        runtimeErrorOverlay(),
    ],
    resolve: {
        alias: {
            "@": path.resolve(projectRoot, "client", "src"),
            "@shared": path.resolve(projectRoot, "shared"),
            "@assets": path.resolve(projectRoot, "attached_assets"),
        },
    },
    root: path.resolve(projectRoot, "client"),
    build: {
        outDir: path.resolve(projectRoot, "dist"),
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            onwarn(warning, warn) {
                // Suppress certain warnings
                if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
                warn(warning);
            },
        },
    },
    server: {
        port: Number(process.env.VITE_PORT) || 43717,
        host: "0.0.0.0",
        strictPort: true,
        cors: {
            origin: '*',
            credentials: true,
        },
        hmr: {
            protocol: 'ws',
            host: '0.0.0.0',
            port: Number(process.env.VITE_PORT) || 43717,
            clientPort: Number(process.env.VITE_PORT) || 43717,
            overlay: true,
        },
        watch: {
            usePolling: false,
            interval: 100,
        },
        fs: {
            strict: false,
            allow: [".."],
            deny: [],
        },
    },
    optimizeDeps: {
        exclude: [],
        include: [
            'react',
            'react-dom',
            'react-dom/client',
        ],
    },
    clearScreen: false,
    logLevel: 'info',
});
