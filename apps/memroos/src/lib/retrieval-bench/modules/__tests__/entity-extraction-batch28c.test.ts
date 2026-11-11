// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch28c — invalid surfaces and date tokens", () => {
  it("increments invalidSurface for sentence-initial stop words (lines 356-358)", () => {
    const result = extractEntities("The operator opened batch28c.", {
      nowIso: "2026-10-30T00:00:00.000Z",
      limits: { minEntitySurfaceLength: 2 },
    });
    expect(result.entities.some((e) => e.surface === "The")).toBe(false);
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });

  it("classifies ISO dates via classifyKind (lines 270-271)", () => {
    const result = extractEntities("Ship on 2026-07-17 for batch28c.", { nowIso: "2026-10-30T00:00:00.000Z" });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("2026-07-17"))).toBe(true);
  });

  it("returns extraction_text_missing for non-string input (lines 314-320)", () => {
    const result = extractEntities(undefined as unknown as string);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extraction_text_missing");
  });
});
