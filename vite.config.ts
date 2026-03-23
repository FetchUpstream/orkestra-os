import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

declare const process: {
  env: Record<string, string | undefined>;
};

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    ...(process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT
      ? [
          sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            release: {
              name: process.env.SENTRY_RELEASE,
            },
          }),
        ]
      : []),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/target/**",
        "**/*.rs",
        "**/Cargo.toml",
        "**/Cargo.lock",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/lang-markdown",
      "@lezer/common",
    ],
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    server: {
      deps: {
        inline: ["@solidjs/router"],
      },
    },
  },
});
