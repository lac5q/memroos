import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import type { UserWorkspaceConfig } from "vitest/config";

// Slow suite — runs *only* the tests tagged `slow`. Used by `npm run test:slow`
// and the CI slow-test job so the milestone gate (`npm test -- --run`) stays
// fast and reliable while the slow coverage (bcrypt-heavy auth + onboarding
// route setup) still runs to completion here.
//
// Same intersection pattern as `vitest.config.ts`: vitest 4.1 types
// `tagsFilter` on its internal UserConfig (not UserWorkspaceConfig), but
// the runtime accepts it inside `test.*` as the gate filter.
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
    // Re-use the same tag definition so vitest does not throw
    // strictTags errors when both configs are parsed in the same workspace.
    tags: [
      {
        name: "slow",
        description:
          "Slow tests such as bcrypt password hashing and onboarding route setup. Run via npm run test:slow.",
        timeout: 60_000,
      },
    ],
    tagsFilter: ["slow"],
    // Bcrypt cost 12 hashing can take ~1s per call; give each slow test
    // a generous ceiling so transient CI noise does not flake the run.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Mirror fast-suite coverage excludes so slow CI coverage does not
    // count shared __tests__ helpers toward product coverage.
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
