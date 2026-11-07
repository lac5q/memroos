// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { dedupeRetrievalResults, decideMerge } from "@/lib/retrieval-bench/modules/dedupe";
import type { RetrievedItem } from "@/lib/retrieval-bench/schema";

function item(partial: Partial<RetrievedItem> & Pick<RetrievedItem, "id">): RetrievedItem {
  return {
    text: partial.text ?? partial.id,
    tier: partial.tier ?? "vector-local",
    source: partial.source ?? "test",
    score: partial.score ?? 1,
    rankPosition: partial.rankPosition ?? 0,
    authorizationResult: partial.authorizationResult ?? "allowed",
    whyEntered: partial.whyEntered ?? "batch30b",
    scopeHash: partial.scopeHash ?? `scope-${randomUUID().slice(0, 6)}`,
    timestamp_iso: partial.timestamp_iso ?? "2026-10-31T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch30b — buildKey, derivative guard, mergedLog reuse", () => {
  it("isExactDerivative rejects identical ids (line 98)", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-same-b30b", tier: "lexical" }),
      candidate: item({ id: "mem-same-b30b", tier: "lexical" }),
    });
    expect(decision.merge).toBe(true);
  });

  it("decideMerge rejects tier-mismatched derivatives (lines 93–94)", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-a", tier: "lexical", scopeHash: "scope-1" }),
      candidate: item({ id: "mem-a-vector", tier: "graph-local", scopeHash: "scope-1" }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_canonical_id");
  });

  it("dedupeRetrievalResults appends to existing mergedLog bucket (line 172)", () => {
    const shared = `body-${randomUUID().slice(0, 8)}`;
    const base = item({ id: "mem-root-b30b", text: shared, score: 0.4, rankPosition: 1 });
    const dupA = item({ id: "mem-root-b30b", text: shared, score: 0.2, rankPosition: 2 });
    const dupB = item({ id: "mem-root-b30b", text: shared, score: 0.1, rankPosition: 3 });
    const result = dedupeRetrievalResults({ items: [base, dupA, dupB] });
    expect(result.items).toHaveLength(1);
    expect(result.merged[0]?.droppedIds.length).toBeGreaterThanOrEqual(1);
    expect(result.receipt.canonicalHash).toMatch(/^sha256:/);
  });
});
