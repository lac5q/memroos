// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decideEntityMerge, extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch16c — short text and merge drops", () => {
  it("extractEntities returns ok with zero entities for punctuation-only input", () => {
    const result = extractEntities("... !!!");
    expect(result.ok).toBe(true);
    expect(result.entities).toHaveLength(0);
  });

  it("decideEntityMerge drops candidates with empty canonical ids", () => {
    const merged = decideEntityMerge({
      scope: "tenant/default",
      candidates: [
        {
          id: "ok",
          surface: "MemRoOS",
          canonical: "memroos",
          kind: "org",
          aliasCount: 1,
          aliases: ["MemRoOS"],
          spanHash: "span-ok",
          firstOffset: 0,
          lastOffset: 7,
        },
        {
          id: "bad",
          surface: "",
          canonical: "",
          kind: "org",
          aliasCount: 0,
          aliases: [],
          spanHash: "span-bad",
          firstOffset: 0,
          lastOffset: 0,
        },
      ],
      nowIso: "2026-07-01T00:00:00.000Z",
    });
    expect(merged.ok).toBe(true);
    expect(merged.keptEntities).toHaveLength(1);
    expect(merged.droppedEntities.length).toBeGreaterThan(0);
  });
});
