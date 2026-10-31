// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch23 — classifyKind organization and person", () => {
  it("classifies single capitalized tokens as organization", () => {
    const result = extractEntities("Acme shipped the release.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(result.entities.some((entity) => entity.kind === "organization" && entity.surface === "Acme")).toBe(true);
  });

  it("classifies multi-word capitalized names as person", () => {
    const result = extractEntities("Escalate to Jane Doe immediately.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(result.entities.some((entity) => entity.kind === "person")).toBe(true);
  });

  it("marks invalidSurface when surface exceeds maxEntitySurfaceLength", () => {
    const long = "Ab" + "c".repeat(100);
    const result = extractEntities(`${long} followed by ShortName`, {
      limits: { minEntitySurfaceLength: 2, maxEntitySurfaceLength: 20 },
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });
});
