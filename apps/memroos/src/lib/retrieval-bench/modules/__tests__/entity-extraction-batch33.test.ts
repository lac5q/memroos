// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch33 — classifyKind branches", () => {
  const marker = randomUUID().slice(0, 8);
  const nowIso = "2026-11-10T09:00:00.000Z";

  it("classifyKind date via slash numeric date (271)", () => {
    const result = extractEntities(`Cutover on 03/15/2027 for batch33 ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("03/15/2027"))).toBe(true);
  });

  it("classifyKind identifier for ticket token (272)", () => {
    const result = extractEntities("Escalate BUG-3310 before batch33 review.", { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && e.surface === "BUG-3310")).toBe(true);
  });

  it("classifyKind organization for single CapWord (277)", () => {
    const result = extractEntities(`Memroos batch33 partners with Stripe.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "organization" && e.surface === "Stripe")).toBe(true);
  });

  it("rejects proper-noun surfaces containing embedded newline (362–363)", () => {
    const result = extractEntities("Prefix\nBad\nToken tail.", { nowIso });
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(result.entities.every((e) => !/\n/.test(e.surface))).toBe(true);
  });
});
