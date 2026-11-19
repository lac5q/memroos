// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch18 — kind heuristics and alias limits", () => {
  it("classifies ISO dates, identifiers, and multi-word person names", () => {
    const result = extractEntities(
      "On 2026-07-01 Jane Smith opened ticket REQ-12345 for Acme Corp.",
      { nowIso: "2026-07-10T00:00:00.000Z" },
    );
    expect(result.ok).toBe(true);
    const kinds = new Set(result.entities.map((entity) => entity.kind));
    expect(kinds.has("date")).toBe(true);
    expect(kinds.has("identifier")).toBe(true);
    expect(result.entities.some((entity) => entity.kind === "person" && entity.surface.includes("Jane"))).toBe(
      true,
    );
  });

  it("increments overExpansionLimit when alias variants exceed maxExpansionPerEntity", () => {
    const text = "Acme Corp, ACME CORP, and Acme  Corp share one canonical entity.";
    const result = extractEntities(text, {
      nowIso: "2026-07-10T00:00:00.000Z",
      limits: { maxExpansionPerEntity: 1, maxAliasChainLength: 8, maxEntitiesPerTask: 8 },
    });
    expect(result.ok).toBe(true);
    expect(result.receipt.rejectedReasons.overExpansionLimit).toBeGreaterThan(0);
  });

  it("increments cycle counter when alias chain exceeds maxAliasChainLength", () => {
    const text = "Brand Alpha, BRAND ALPHA, Brand  Alpha, and Brand-Alpha appear together.";
    const result = extractEntities(text, {
      nowIso: "2026-07-10T00:00:00.000Z",
      limits: { maxExpansionPerEntity: 10, maxAliasChainLength: 1, maxEntitiesPerTask: 8 },
    });
    expect(result.ok).toBe(true);
    expect(result.receipt.rejectedReasons.cycle).toBeGreaterThan(0);
  });
});
