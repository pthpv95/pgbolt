import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and doesn't want vite to obscure Rust errors.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't reload the frontend when Rust files change.
      ignored: ["**/src-tauri/**"],
    },
  },
});
