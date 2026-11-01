// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch25 — classifyKind heuristics and surface guards", () => {
  const nowIso = "2026-10-30T00:00:00.000Z";

  it("classifies multi-word capitalized surfaces as person", () => {
    const result = extractEntities("Analyst Jane Doe filed the report.", { nowIso });
    expect(result.entities.some((e) => e.kind === "person" && e.surface.includes("Jane Doe"))).toBe(true);
  });

  it("classifies acronym-shaped proper nouns via classifyKind acronym branch", () => {
    const result = extractEntities("Team NASA launched the module.", { nowIso });
    expect(result.entities.some((e) => e.kind === "acronym" && e.surface === "NASA")).toBe(true);
  });

  it("classifies numeric date surfaces embedded in proper-noun scan as date", () => {
    const result = extractEntities("Deadline 10/30/2026 is firm.", { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("10/30/2026"))).toBe(true);
  });

  it("classifies single capitalized token as organization when not an acronym", () => {
    const result = extractEntities("Contoso updated the playbook.", { nowIso });
    expect(result.entities.some((e) => e.kind === "organization" && e.surface === "Contoso")).toBe(true);
  });

  it("rejects proper-noun surfaces containing embedded newlines when reachable", () => {
    const text = "Lead\nCapword team";
    const result = extractEntities(text, { nowIso });
    if (result.receipt.rejectedReasons.invalidSurface > 0) {
      expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    } else {
      expect(result.entities.every((entity) => !entity.surface.includes("\n"))).toBe(true);
    }
  });
});
