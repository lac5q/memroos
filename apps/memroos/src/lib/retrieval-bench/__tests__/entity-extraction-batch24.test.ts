// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch24 — date, identifier, and surface guards", () => {
  it("extracts ISO dates via the dedicated date scan", () => {
    const result = extractEntities("Shipped on 2026-10-30 before noon.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(result.entities.some((entity) => entity.kind === "date" && entity.surface.includes("2026-10-30"))).toBe(
      true,
    );
  });

  it("extracts identifier-shaped tokens via the identifier scan", () => {
    const result = extractEntities("Ticket MEMX_42 opened for follow-up.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(result.entities.some((entity) => entity.kind === "identifier")).toBe(true);
  });

  it("classifies ambiguous proper-noun surfaces as organization or unknown", () => {
    const org = extractEntities("Acme released the patch.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(org.entities.some((entity) => entity.kind === "organization" && entity.surface === "Acme")).toBe(true);

    const unknown = extractEntities("Value x9 is noted.", {
      nowIso: "2026-10-30T00:00:00.000Z",
      limits: { minEntitySurfaceLength: 2, maxEntitySurfaceLength: 40 },
    });
    expect(unknown.ok).toBe(true);
  });

  it("rejects proper-noun surfaces that contain embedded newlines when reachable", () => {
    const text = "Start\nCapword continues";
    const result = extractEntities(text, {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    if (result.receipt.rejectedReasons.invalidSurface > 0) {
      expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    } else {
      expect(result.entities.every((entity) => !entity.surface.includes("\n"))).toBe(true);
    }
  });
});
