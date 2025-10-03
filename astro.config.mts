import node from "@astrojs/node";
import react from "@astrojs/react";
import browserslist from "browserslist";
import { browserslistToTargets } from "lightningcss";
import { defineConfig, envField } from "astro/config";

// https://astro.build/config
export default defineConfig({
  adapter: node({
    mode: "standalone",
  }),
  base: "/Horion",
  env: {
    schema: {
      SEED_MOCK: envField.string({
        context: "server",
        access: "public",
      }),
      DATABRICKS_HOST: envField.string({
        context: "server",
        access: "public",
        url: true,
      }),
      DATABRICKS_TOKEN: envField.string({
        context: "server",
        access: "secret",
      }),
      DATABRICKS_CLUSTER_ID: envField.string({
        context: "server",
        access: "secret",
      }),
      JWT_SECRET: envField.string({
        context: "server",
        access: "secret",
      }),
    },
  },
  experimental: {
    clientPrerender: true,
  },
  integrations: [react()],
  prefetch: {
    prefetchAll: true,
  },
  vite: {
    build: {
      cssMinify: "lightningcss",
    },
    css: {
      transformer: "lightningcss",
      lightningcss: {
        targets: browserslistToTargets(browserslist(">= 1.5%")),
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
    server: {
      watch: {
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/db/data/**",
        ],
      },
    },
  },
});
