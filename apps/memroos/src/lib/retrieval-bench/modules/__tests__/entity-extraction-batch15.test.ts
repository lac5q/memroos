// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch15 — limits and date surfaces", () => {
  it("classifies numeric slash dates and rejects overlong surfaces", () => {
    const longOrg = `Acme ${"International ".repeat(20)}Holdings`;
    const r = extractEntities(`Deadline 04/15/2026 for ${longOrg}.`, {
      version: "v1",
      seed: 0,
      limits: { maxEntitySurfaceLength: 40 },
    });
    expect(r.entities.some((e) => e.kind === "date")).toBe(true);
    expect(r.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });

  it("rejects sentence-initial stopword capitalizations", () => {
    const r = extractEntities("The company shipped parts.", { version: "v1", seed: 0 });
    expect(r.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });

  it("flags overEntityLimit when maxEntitiesPerTask is exceeded", () => {
    const text = "Jane Smith met John Doe with Acme Corp and NASA and IBM and Intel and Oracle.";
    const r = extractEntities(text, {
      version: "v1",
      seed: 0,
      limits: { maxEntitiesPerTask: 1, maxExpansionPerEntity: 10, maxAliasChainLength: 8 },
    });
    expect(r.receipt.rejectedReasons.overEntityLimit).toBeGreaterThan(0);
  });
});
