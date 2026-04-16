import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    setupFiles: ["./src/test-setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // In-memory bindings for tests — no real Cloudflare account needed
          d1Databases: { DB: "test-meridian-licence" },
          kvNamespaces: { LICENCE_KV: "test-licence-kv" },
          bindings: {
            LICENCE_ADMIN_SECRET: "test-admin-secret",
            LICENCE_SECRET: "test-licence-secret",
          },
        },
      },
    },
  },
});
