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
    whyEntered: partial.whyEntered ?? "batch24",
    scopeHash: partial.scopeHash ?? "scope-b24",
    timestamp_iso: partial.timestamp_iso ?? "2026-10-31T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch24 — tier mismatch and score retention", () => {
  it("decideMerge rejects tier mismatches except vector-local pairs", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-a", tier: "lexical", text: "same" }),
      candidate: item({ id: "mem-a_vector", tier: "vector-local", text: "same" }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_canonical_id");
  });

  it("dedupeRetrievalResults keeps higher score and records duplicate ids once", () => {
    const shared = "shared canonical body batch24";
    const result = dedupeRetrievalResults({
      items: [
        item({ id: "mem-1", text: shared, score: 0.4, rankPosition: 1 }),
        item({ id: "mem-1", text: shared, score: 0.9, rankPosition: 2 }),
        item({ id: "mem-1", text: shared, score: 0.9, rankPosition: 3 }),
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.score).toBe(0.9);
    expect(result.merged[0]?.droppedIds).toEqual(["mem-1"]);
  });

  it("decideMerge rejects derivatives with distinct timestamps", () => {
    const decision = decideMerge({
      existing: item({
        id: "mem-x",
        text: "payload",
        scopeHash: "scope-b24",
        timestamp_iso: "2026-10-31T00:00:00.000Z",
      }),
      candidate: item({
        id: "mem-x-vector",
        text: "payload",
        scopeHash: "scope-b24",
        timestamp_iso: "2026-10-31T01:00:00.000Z",
      }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_timestamp");
  });
});
