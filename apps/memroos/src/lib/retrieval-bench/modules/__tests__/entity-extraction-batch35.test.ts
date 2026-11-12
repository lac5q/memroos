// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch35", () => {
  const marker = randomUUID().slice(0, 8);
  const nowIso = "2026-11-12T09:00:00.000Z";

  it("classifyKind date via slash numeric date (271)", () => {
    const result = extractEntities(`Cutover on 12/01/2027 for batch35 ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("12/01/2027"))).toBe(true);
  });

  it("classifyKind identifier for ticket token (272)", () => {
    const result = extractEntities(`Track INC-3501 during batch35 ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && e.surface === "INC-3501")).toBe(true);
  });

  it("classifyKind organization for single CapWord (277)", () => {
    const result = extractEntities(`Memroos batch35 relies on Cloudflare ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "organization" && e.surface === "Cloudflare")).toBe(true);
  });

  it("classifyKind person for multi CapWord sequence (275)", () => {
    const result = extractEntities(`Signed by Marie Curie on batch35 ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "person" && e.surface === "Marie Curie")).toBe(true);
  });

  it("rejects proper-noun surfaces containing embedded newline (362–363)", () => {
    const result = extractEntities("Lead\nBad\nSurface tail.", { nowIso });
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(result.entities.every((e) => !/\n/.test(e.surface))).toBe(true);
  });

  it("returns extraction_text_missing for undefined text (314–320)", () => {
    const result = extractEntities(undefined as unknown as string, { nowIso });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extraction_text_missing");
  });
});
