// import node from "@astrojs/node";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import browserslist from "browserslist";
import { browserslistToTargets } from "lightningcss";
import { defineConfig, envField } from "astro/config";

// https://astro.build/config
export default defineConfig({
  adapter: vercel({
    webAnalytics: {
      enabled: true,
    },
    isr: true,
  }),
  // output: "server",
  // base: "/Horion",
  prefetch: {
    prefetchAll: true,
  },
  experimental: {
    clientPrerender: true,
  },
  integrations: [react()],
  vite: {
    css: {
      transformer: "lightningcss",
      lightningcss: {
        targets: browserslistToTargets(browserslist(">= 1.5%")),
      },
    },
    build: {
      cssMinify: "lightningcss",
    },
  },
  env: {
    schema: {
      MOTHERDUCK_TOKEN: envField.string({
        context: "server",
        access: "secret",
      }),
      MOTHERDUCK_READ_SCALING_TOKEN: envField.string({
        context: "server",
        access: "secret",
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
});
