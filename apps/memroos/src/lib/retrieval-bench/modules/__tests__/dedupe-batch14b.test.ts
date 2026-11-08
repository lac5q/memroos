// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decideMerge, dedupeRetrievalResults, DEDUPE_STAGE_VERSION } from "@/lib/retrieval-bench/modules/dedupe";
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

describe("retrieval dedupe batch14b", () => {
  it("decideMerge rejects distinct canonical ids that are not derivatives", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-a", tier: "vector-local" }),
      candidate: item({ id: "mem-b", tier: "vector-local" }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_canonical_id");
  });

  it("decideMerge merges identical content hashes for the same canonical id", () => {
    const shared = item({ id: "mem-1", text: "same body", tier: "vector-local" });
    const decision = decideMerge({
      existing: shared,
      candidate: item({ id: "mem-1", text: "same body", tier: "vector-local" }),
    });
    expect(decision.merge).toBe(true);
  });

  it("decideMerge rejects derivative ids when content hashes diverge", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-1", text: "alpha", tier: "vector-local", scopeHash: "scope", timestamp_iso: "2026-01-01T00:00:00Z" }),
      candidate: item({ id: "mem-1-vector", text: "beta", tier: "vector-local", scopeHash: "scope", timestamp_iso: "2026-01-01T00:00:00Z" }),
    });
    expect(decision.merge).toBe(false);
  });

  it("dedupeRetrievalResults keeps highest score and emits receipt metadata", () => {
    const duplicateText = "shared fact about checkout";
    const result = dedupeRetrievalResults({
      items: [
        item({ id: "mem-1", text: duplicateText, score: 0.4 }),
        item({ id: "mem-1", text: duplicateText, score: 0.9 }),
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.score).toBe(0.9);
    expect(result.receipt.stageVersion).toBe(DEDUPE_STAGE_VERSION);
    expect(result.receipt.mergedCount).toBeGreaterThan(0);
  });

  it("dedupeRetrievalResults preserves distinct scope hashes for derivatives", () => {
    const result = dedupeRetrievalResults({
      items: [
        item({ id: "mem-2", tier: "vector-local", scopeHash: "a", timestamp_iso: "2026-01-01T00:00:00Z" }),
        item({ id: "mem-2-vector", tier: "vector-local", scopeHash: "b", timestamp_iso: "2026-01-01T00:00:00Z" }),
      ],
    });
    expect(result.items).toHaveLength(2);
    expect(result.receipt.rejectedDistinctCount).toBeGreaterThan(0);
  });
});
