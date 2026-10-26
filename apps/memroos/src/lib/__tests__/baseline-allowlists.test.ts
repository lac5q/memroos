// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SQLITE_DIRECT_IMPORT_ALLOWLIST } from "../sqlite-allowlist.mjs";
import { LIB_ROOT_RESERVED } from "../lib-boundary-baseline.mjs";

describe("baseline allowlist modules", () => {
  it("exports a non-empty sqlite direct-import allowlist", () => {
    expect(Array.isArray(SQLITE_DIRECT_IMPORT_ALLOWLIST)).toBe(true);
    expect(SQLITE_DIRECT_IMPORT_ALLOWLIST.length).toBeGreaterThan(0);
    expect(SQLITE_DIRECT_IMPORT_ALLOWLIST.every((entry) => typeof entry === "string")).toBe(
      true
    );
  });

  it("exports reserved lib-root primitives", () => {
    expect(Array.isArray(LIB_ROOT_RESERVED)).toBe(true);
    expect(LIB_ROOT_RESERVED).toContain("env.ts");
  });
});
