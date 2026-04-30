/**
 * ─── Vite Build Configuration ───
 *
 * Plugins:
 *   - @vitejs/plugin-react — Fast Refresh + JSX transform for React 19
 *   - @tailwindcss/vite — Tailwind CSS v4 JIT compiler (processes @import "tailwindcss")
 *
 * Resolve aliases:
 *   - "@" maps to src/ — allows imports like `import { ... } from "@/components/..."``
 *
 * Dev server proxy:
 *   - /api requests are forwarded to http://localhost:3000 (Express backend)
 *     so the frontend can call /api/* without CORS issues during development.
 */
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
