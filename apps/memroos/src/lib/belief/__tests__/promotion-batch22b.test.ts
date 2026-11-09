// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizeCategory } from "../promotion";

describe("belief promotion batch22b — category normalization", () => {
  it("normalizeCategory trims and lowercases known categories", () => {
    expect(normalizeCategory("  PRICING ")).toBe("pricing");
    expect(normalizeCategory("unknown-label")).toBe("unclassified");
  });
});
