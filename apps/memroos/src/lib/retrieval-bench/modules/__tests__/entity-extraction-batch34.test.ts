// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch34 — classifyKind and scan guards", () => {
  const marker = randomUUID().slice(0, 8);
  const nowIso = "2026-11-11T09:00:00.000Z";

  it("returns extraction_text_missing for non-string input (314–320)", () => {
    const result = extractEntities(null as unknown as string, { nowIso });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extraction_text_missing");
  });

  it("classifyKind date via slash numeric date (271)", () => {
    const result = extractEntities(`Cutover on 11/15/2027 for batch34 ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("11/15/2027"))).toBe(true);
  });

  it("classifyKind identifier for ticket token (272)", () => {
    const result = extractEntities(`Track REQ-3401 during batch34 ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && e.surface === "REQ-3401")).toBe(true);
  });

  it("classifyKind person for multi CapWord sequence (275)", () => {
    const result = extractEntities(`Signed by Marie Curie on batch34 ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "person" && e.surface === "Marie Curie")).toBe(true);
  });

  it("classifyKind organization for single CapWord (277)", () => {
    const result = extractEntities(`Memroos batch34 uses Datadog.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "organization" && e.surface === "Datadog")).toBe(true);
  });

  it("rejects proper-noun surfaces containing embedded newline (362–363)", () => {
    const result = extractEntities("Lead\nBad\nSurface tail.", { nowIso });
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(result.entities.every((e) => !/\n/.test(e.surface))).toBe(true);
  });

  it("records overEntityLimit when caps bind (494–496)", () => {
    const blob = Array.from({ length: 40 }, (_, i) => `Entity${i}Corp`).join(" ");
    const result = extractEntities(blob, { nowIso, limits: { maxEntitiesPerTask: 3 } });
    expect(result.receipt.rejectedReasons.overEntityLimit).toBeGreaterThan(0);
  });
});
