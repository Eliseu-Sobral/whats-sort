// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Allow switching the nitro build preset via env (e.g. BUILD_PRESET=node-server for VPS/Docker).
const preset = process.env.BUILD_PRESET || "node-server";

export default defineConfig({
  nitro: {
    preset,
    // O TanStack Start v1 utiliza o entry do servidor em src/server.ts
    server: {
      entry: "server",
    },
  },
});

