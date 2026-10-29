// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decideMerge, dedupeRetrievalResults } from "@/lib/retrieval-bench/modules/dedupe";
import type { RetrievedItem } from "@/lib/retrieval-bench/schema";

function item(partial: Partial<RetrievedItem> & Pick<RetrievedItem, "id">): RetrievedItem {
  return {
    text: partial.text ?? partial.id,
    tier: partial.tier ?? "vector-local",
    source: partial.source ?? "test",
    score: partial.score ?? 1,
    rankPosition: partial.rankPosition ?? 0,
    authorizationResult: partial.authorizationResult ?? "allowed",
    whyEntered: partial.whyEntered ?? "test-fixture",
    scopeHash: partial.scopeHash,
    timestamp_iso: partial.timestamp_iso,
    ...partial,
  };
}

describe("retrieval dedupe batch17 — derivative and merge-log edges", () => {
  it("decideMerge rejects derivatives with distinct timestamps", () => {
    const decision = decideMerge({
      existing: item({
        id: "mem-1",
        tier: "vector-local",
        scopeHash: "scope-a",
        timestamp_iso: "2026-01-01T00:00:00Z",
      }),
      candidate: item({
        id: "mem-1_vector",
        tier: "vector-local",
        scopeHash: "scope-a",
        timestamp_iso: "2026-01-02T00:00:00Z",
      }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_timestamp");
  });

  it("decideMerge rejects tier mismatches that are not vector-local pairs", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-1", tier: "lexical" }),
      candidate: item({ id: "mem-1-vector", tier: "vector-local" }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_canonical_id");
  });

  it("dedupeRetrievalResults appends to existing merge log for repeated drops", () => {
    const shared = "duplicate canonical body";
    const result = dedupeRetrievalResults({
      items: [
        item({ id: "mem-9", text: shared, score: 0.5 }),
        item({ id: "mem-9", text: shared, score: 0.6 }),
        item({ id: "mem-9", text: shared, score: 0.7 }),
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.receipt.mergedCount).toBeGreaterThanOrEqual(1);
    expect(result.merged[0]?.droppedIds.length).toBeGreaterThanOrEqual(1);
  });

  it("dedupeRetrievalResults sorts by tier then id for determinism", () => {
    const result = dedupeRetrievalResults({
      items: [
        item({ id: "z-last", tier: "vector-local" }),
        item({ id: "a-first", tier: "lexical" }),
      ],
    });
    expect(result.items.map((entry) => entry.id)).toEqual(["a-first", "z-last"]);
  });
});
