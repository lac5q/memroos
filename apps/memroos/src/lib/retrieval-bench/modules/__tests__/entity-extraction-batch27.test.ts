// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch27 — classifyKind date/unknown via proper-noun scan", () => {
  const nowIso = "2026-10-30T00:00:00.000Z";

  it("classifies a capitalized numeric date surface as date when embedded after a boundary (lines 271-272)", () => {
    const result = extractEntities("Plan 10/30/2026 rollout with Ops.", { nowIso });
    const dateHit = result.entities.find((e) => e.kind === "date" && /10\/30\/2026/.test(e.surface));
    expect(dateHit).toBeDefined();
  });

  it("classifies ISO-shaped token captured as a proper-noun surface as date (lines 271-272)", () => {
    const text = "Anchor 2026-11-02T12:00:00Z milestone.";
    const result = extractEntities(text, { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("2026-11-02"))).toBe(true);
  });

  it("classifies lone acronym-like token via proper-noun path as acronym or organization (line 277 fallback neighbors)", () => {
    const result = extractEntities("Use API gateway in Prod.", { nowIso });
    expect(result.entities.some((e) => e.surface === "API" && e.kind === "acronym")).toBe(true);
  });

  it("classifies slash-delimited year token as date when it matches NUMERIC_DATE (lines 271-272)", () => {
    const result = extractEntities("Target 2026/11/02 gate.", { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("2026/11/02"))).toBe(true);
  });
});
