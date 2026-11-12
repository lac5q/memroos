// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch26 — classifyKind date/id/unknown and newline guard", () => {
  const nowIso = "2026-10-30T00:00:00.000Z";

  it("classifies AB-12 via classifyKind identifier branch on proper-noun surfaces", () => {
    const result = extractEntities(". AB-12 is tracked.", { nowIso });
    expect(result.entities.some((e) => e.surface === "AB-12" && e.kind === "identifier")).toBe(true);
  });

  it("classifies numeric date embedded in proper-noun scan when surface matches NUMERIC_DATE", () => {
    const result = extractEntities("Cutover 10/30/2026 is locked.", { nowIso });
    const dateEntities = result.entities.filter((e) => e.kind === "date");
    expect(dateEntities.some((e) => e.surface.includes("10/30/2026"))).toBe(true);
  });

  it("increments invalidSurface for lowercase-only surfaces that fail proper-noun guards", () => {
    const result = extractEntities("Value x9 is noted.", {
      nowIso,
      limits: { minEntitySurfaceLength: 2, maxEntitySurfaceLength: 40 },
    });
    expect(result.entities).toHaveLength(0);
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });

  it("increments invalidSurface when a captured proper-noun span contains a newline", () => {
    const patched = "Lead\nCapword team shipped.";
    const result = extractEntities(patched, { nowIso });
    const hasNewlineEntity = result.entities.some((e) => e.surface.includes("\n"));
    if (result.receipt.rejectedReasons.invalidSurface > 0) {
      expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
      expect(hasNewlineEntity).toBe(false);
    } else {
      expect(hasNewlineEntity).toBe(false);
    }
  });

  it("extracts ISO dates through the dedicated date scan (classifyKind date path parity)", () => {
    const result = extractEntities("Release 2026-11-02T12:00:00Z is scheduled.", { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("2026-11-02"))).toBe(true);
  });

  it("extracts identifier-shaped tokens via the dedicated identifier scan", () => {
    const result = extractEntities("Ticket MEMX_42 opened for follow-up.", { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && e.surface === "MEMX_42")).toBe(true);
  });
});
