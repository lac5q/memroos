// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch31 — classifyKind branches and newline guard", () => {
  const nowIso = "2026-11-08T09:00:00.000Z";

  it("classifyKind returns date for numeric surfaces on proper-noun path (271–272)", () => {
    const result = extractEntities("Deadline 12/01/2026 for batch31 freeze.", { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("12/01/2026"))).toBe(true);
  });

  it("classifyKind returns identifier for ticket-shaped proper nouns (272)", () => {
    const result = extractEntities("Escalate BUG-3310 before review.", { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && e.surface === "BUG-3310")).toBe(true);
  });

  it("classifyKind returns organization for single CapWord tokens (277)", () => {
    const result = extractEntities("Memroos batch31 partners with Stripe.", { nowIso });
    expect(result.entities.some((e) => e.kind === "organization" && e.surface === "Stripe")).toBe(true);
  });

  it("rejects proper-noun surfaces containing newlines (362–363)", () => {
    const result = extractEntities("Prefix\nBad\nToken tail.", { nowIso });
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(result.entities.every((e) => !/\n/.test(e.surface))).toBe(true);
  });
});
