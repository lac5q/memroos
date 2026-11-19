// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch22 — classifyKind branches and invalidSurface", () => {
  it("classifies slash numeric dates and REQ identifiers", () => {
    const slashDate = extractEntities("Ship on 07/10/2026 with logistics.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(slashDate.ok).toBe(true);
    expect(slashDate.entities.some((entity) => entity.kind === "date")).toBe(true);

    const identifier = extractEntities("Open ticket INC-44001 for review.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(identifier.ok).toBe(true);
    expect(identifier.entities.some((entity) => entity.kind === "identifier")).toBe(true);
  });

  it("extracts ISO date entities alongside identifier tokens in one pass", () => {
    const result = extractEntities("Track REQ-778899 before 2026-11-05 cutoff.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(result.entities.some((entity) => entity.kind === "date")).toBe(true);
    expect(result.entities.some((entity) => entity.kind === "identifier")).toBe(true);
  });

  it("increments invalidSurface when captured surface contains an embedded newline", () => {
    const injected = "Kickoff with Team\nLead on Monday.";
    const result = extractEntities(injected, { nowIso: "2026-10-28T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(result.entities.every((entity) => !entity.surface.includes("\n"))).toBe(true);
  });
});
