import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const android = loadEnv(mode, ".", "GENZO_ANDROID_").GENZO_ANDROID_FRONTEND === "1";
  return {
  define: { __GENZO_ANDROID__: android },
  publicDir: android ? false : "public",
  plugins: [react(), ...(android ? [{
    name: "genzo-android-entry",
    transformIndexHtml: { order: "pre" as const, handler: (html: string) => html.replace("/src/main.tsx", "/src/android/main.tsx").replace("/genzo-icon.svg", "/public/genzo-icon.svg") },
  }] : [])],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/target/**", "**/.tooling/**", "**/.pnpm-store/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
};
});
