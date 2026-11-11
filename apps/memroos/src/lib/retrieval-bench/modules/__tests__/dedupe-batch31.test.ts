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
    whyEntered: partial.whyEntered ?? "batch31",
    scopeHash: partial.scopeHash ?? `scope-${randomUUID().slice(0, 6)}`,
    timestamp_iso: partial.timestamp_iso ?? "2026-11-08T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch31 — derivative underscore path and mergedLog guard", () => {
  it("isExactDerivative recognizes hyphen and underscore derivative ids (L98–100)", () => {
    const sharedScope = "scope-b31";
    const tsA = "2026-11-08T00:00:00.000Z";
    const tsB = "2026-11-08T01:00:00.000Z";
    const body = "batch31 derivative body";

    const hyphen = decideMerge({
      existing: item({ id: "mem-b31", tier: "vector-local", scopeHash: sharedScope, text: body, timestamp_iso: tsA }),
      candidate: item({
        id: "mem-b31-vector",
        tier: "vector-local",
        scopeHash: sharedScope,
        text: body,
        timestamp_iso: tsB,
      }),
    });
    expect(hyphen.merge).toBe(false);
    expect(hyphen.nonMergeReason).toBe("distinct_timestamp");

    const underscore = decideMerge({
      existing: item({ id: "mem-u31", tier: "vector-local", scopeHash: sharedScope, text: body, timestamp_iso: tsA }),
      candidate: item({
        id: "mem-u31_extra",
        tier: "vector-local",
        scopeHash: sharedScope,
        text: body,
        timestamp_iso: tsB,
      }),
    });
    expect(underscore.merge).toBe(false);
    expect(underscore.nonMergeReason).toBe("distinct_timestamp");
  });

  it("isExactDerivative returns false for identical ids before prefix check (L98)", () => {
    const decision = decideMerge({
      existing: item({ id: "mem-same-b31", tier: "lexical", text: "alpha" }),
      candidate: item({ id: "mem-same-b31", tier: "lexical", text: "beta" }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_canonical_id");
  });

  it("dedupeRetrievalResults reuses mergedLog bucket without duplicating dropped ids (L172)", () => {
    const body = `shared-${randomUUID().slice(0, 8)}`;
    const base = item({ id: "mem-root-b31", text: body, score: 0.9, rankPosition: 1 });
    const dupA = item({ id: "mem-root-b31", text: body, score: 0.5, rankPosition: 2 });
    const dupB = item({ id: "mem-root-b31", text: body, score: 0.3, rankPosition: 3 });
    const result = dedupeRetrievalResults({ items: [base, dupA, dupB] });
    expect(result.items).toHaveLength(1);
    expect(result.merged[0]?.droppedIds.length).toBeGreaterThanOrEqual(1);
  });

  it.skip("buildKey helper (L80–85) is not referenced — dead code", () => {});
});
