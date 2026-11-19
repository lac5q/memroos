// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  decideEntityMerge,
  extractEntities,
  ENTITY_EXTRACTOR_VERSION,
  type ExtractedEntity,
} from "../modules/entity-extraction";

function fixtureEntity(id: string, canonical: string, surface: string): ExtractedEntity {
  return {
    id,
    surface,
    canonical,
    kind: "org",
    aliasCount: 1,
    aliases: [surface],
    spanHash: `span-${id}`,
    firstOffset: 0,
    lastOffset: surface.length,
  };
}

describe("entity-extraction batch16b — guards and merge", () => {
  it("extractEntities rejects non-string input", () => {
    const result = extractEntities(null as unknown as string);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extraction_text_missing");
  });

  it("extractEntities filters sentence-initial stop words and newline surfaces", () => {
    const withStop = extractEntities("The quick brown fox met Acme Corp.", {
      nowIso: "2026-07-01T00:00:00.000Z",
    });
    expect(withStop.ok).toBe(true);
    expect(withStop.entities.some((e) => e.surface === "The")).toBe(false);
    expect(withStop.entities.some((e) => e.surface === "Acme Corp")).toBe(true);

    const newlineSurface = extractEntities("Start\nBroken Entity name here.", {
      nowIso: "2026-07-01T00:00:00.000Z",
    });
    expect(newlineSurface.receipt.extractorVersion).toBe(ENTITY_EXTRACTOR_VERSION);
    expect(newlineSurface.entities.every((e) => !/\n/.test(e.surface))).toBe(true);
  });

  it("decideEntityMerge requires scope and dedupes by entity id", () => {
    const denied = decideEntityMerge({
      scope: "",
      candidates: [fixtureEntity("e1", "memroos", "MemRoOS")],
      nowIso: "2026-07-01T00:00:00.000Z",
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("scope_required");

    const merged = decideEntityMerge({
      scope: "tenant/default",
      candidates: [
        fixtureEntity("e1", "memroos", "MemRoOS"),
        fixtureEntity("e1", "memroos", "MemRoOS"),
        fixtureEntity("e2", "cursor", "Cursor"),
      ],
      nowIso: "2026-07-01T00:00:00.000Z",
    });
    expect(merged.ok).toBe(true);
    expect(merged.keptEntities).toHaveLength(2);
    expect(merged.droppedEntities).toHaveLength(0);
    const withInvalid = decideEntityMerge({
      scope: "tenant/default",
      candidates: [fixtureEntity("e3", "valid", "Valid"), { ...fixtureEntity("", "", ""), id: "" }],
      nowIso: "2026-07-01T00:00:00.000Z",
    });
    expect(withInvalid.droppedEntities.length).toBeGreaterThan(0);
  });
});
