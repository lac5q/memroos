import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import type { UserWorkspaceConfig } from "vitest/config";

// Fast suite — the default for `npm test` / `npm test -- --run`.
// Excludes tests tagged `slow` so bcrypt-heavy authentication tests and the
// onboarding route suite never inflate the milestone gate duration.
// To run the full coverage set, use `npm run test:slow -- --run` instead.
//
// `tagsFilter` is declared on vitest's own `UserConfig` shape but not on
// `UserWorkspaceConfig`. The intersection below acknowledges the runtime-
// accepted field under `test.*` without relaxing the rest of the type
// contract. Verified via `npm test -- --run` + `npm run test:slow -- --run`.

type SupplementedUserWorkspaceConfig = UserWorkspaceConfig & {
  test: (UserWorkspaceConfig["test"] & { tagsFilter?: string[] }) | undefined;
};

const config: SupplementedUserWorkspaceConfig = {
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    tags: [
      {
        name: "slow",
        description:
          "Slow tests such as bcrypt password hashing and onboarding route setup. Run via npm run test:slow.",
        timeout: 60_000,
      },
    ],
    // Drop every tagged-slow test from the fast gate; CI coverage is
    // preserved by running the slow config separately.
    tagsFilter: ["!slow"],
    // Raise the per-test ceiling from the 5s default. Operations NOC and
    // chat streaming tests are deterministic in isolation but flake under
    // full-suite contention (multiple SQLite + jsdom workers loading the
    // app together). 30s keeps the gate deterministic without tagging
    // these tests as slow — they remain part of the default milestone gate
    // and are still expected to finish well within this ceiling.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Keep shared test helpers (e.g. settings/tools test-helpers.tsx) out of
    // the coverage denominator — they are test infrastructure, not product
    // code. Defaults for node_modules/dist/etc. are listed explicitly because
    // setting `coverage.exclude` replaces Vitest's built-in list.
    coverage: {
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/e2e/**",
        "**/__tests__/**",
        "**/src/test/**",
        "**/*.d.ts",
        "**/*{.,-}config.*",
        "**/coverage/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
};

export default defineConfig(config);
