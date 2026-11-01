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
    whyEntered: partial.whyEntered ?? "batch25b",
    scopeHash: partial.scopeHash ?? "scope-b25b",
    timestamp_iso: partial.timestamp_iso ?? "2026-10-31T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch25b — derivative merge and scope rejection", () => {
  it("dedupeRetrievalResults merges identical ids and keeps the higher score", () => {
    const shared = "shared canonical body batch25b";
    const result = dedupeRetrievalResults({
      items: [
        item({ id: "mem-dup-b25b", text: shared, score: 0.2, rankPosition: 1 }),
        item({ id: "mem-dup-b25b", text: shared, score: 0.95, rankPosition: 2 }),
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.score).toBe(0.95);
    expect(result.receipt.mergedCount).toBeGreaterThan(0);
  });

  it("decideMerge rejects derivatives with mismatched scope hashes", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-y", text: "payload", scopeHash: "scope-a" }),
      candidate: item({ id: "mem-y-vector", text: "payload", scopeHash: "scope-b" }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_scope");
  });
});
