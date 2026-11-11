// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch28 — classifyKind identifier, person, organization, unknown", () => {
  const nowIso = "2026-10-30T00:00:00.000Z";

  it("classifies ticket-style identifier surfaces (lines 272, 398)", () => {
    const result = extractEntities("Track INC-9001 in the tracker.", { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && /INC-9001/.test(e.surface))).toBe(true);
  });

  it("classifies multi-word proper nouns as person (lines 275-276)", () => {
    const result = extractEntities("Assign Jane Doe to review the rollout.", { nowIso });
    expect(result.entities.some((e) => e.kind === "person" && e.surface.includes("Jane Doe"))).toBe(true);
  });

  it("classifies single capitalized tokens as organization when not acronym (lines 276-277)", () => {
    const result = extractEntities("Partner with Stripe for billing.", { nowIso });
    expect(result.entities.some((e) => e.kind === "organization" && e.surface === "Stripe")).toBe(true);
  });

  it("does not emit proper-noun entities for all-lowercase prose (line 277 unknown path unused)", () => {
    const result = extractEntities("only lowercase words here", { nowIso });
    expect(result.entities.filter((e) => e.kind === "person" || e.kind === "organization")).toHaveLength(0);
  });
});
