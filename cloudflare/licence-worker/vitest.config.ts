import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    setupFiles: ["./src/test-setup.ts"],
    poolOptions: {
      workers: {
        // Single shared D1 across tests in a file. Otherwise each test
        // gets its own isolated DB and the admin_sessions row written by
        // the first /api/admin/login vanishes before the next test can
        // reuse the cached JWT — verifyJwt's jti revocation check then
        // rejects an otherwise-valid token.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
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
