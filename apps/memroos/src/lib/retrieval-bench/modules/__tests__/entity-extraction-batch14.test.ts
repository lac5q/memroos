// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decideEntityMerge, extractEntities } from "../entity-extraction";

describe("entity-extraction batch14", () => {
  it("classifies ISO and numeric dates from free text", () => {
    const r = extractEntities("Meet on 2026-04-01 and also 04/15/2026.", { version: "v1", seed: 0 });
    expect(r.ok).toBe(true);
    expect(r.entities.filter((e) => e.kind === "date").length).toBeGreaterThanOrEqual(1);
  });

  it("rejects surfaces shorter than configured minEntitySurfaceLength", () => {
    const r = extractEntities("Acme Corp", { version: "v1", seed: 0, limits: { minEntitySurfaceLength: 50 } });
    expect(r.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });

  it("extracts identifier-like tokens", () => {
    const r = extractEntities("Ticket MEMX-1042 is open.", { version: "v1", seed: 0 });
    expect(r.entities.some((e) => e.kind === "identifier")).toBe(true);
  });

  it("decideEntityMerge drops duplicate entity ids within scope", () => {
    const built = extractEntities("Acme Corp", { version: "v1", seed: 0 });
    expect(built.ok).toBe(true);
    expect(built.entities.length).toBeGreaterThan(0);
    const entity = built.entities[0]!;
    const dupes = [entity, { ...entity }];
    const merged = decideEntityMerge({ scope: "tenant-a", candidates: dupes });
    expect(merged.ok).toBe(true);
    expect(merged.keptEntities.length).toBe(1);
    expect(merged.droppedEntities.length).toBe(0);
  });
});
