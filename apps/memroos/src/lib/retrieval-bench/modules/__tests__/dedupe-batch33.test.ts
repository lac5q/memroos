// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { dedupeRetrievalResults, decideMerge } from "@/lib/retrieval-bench/modules/dedupe";
import type { RetrievedItem } from "@/lib/retrieval-bench/schema";

function item(partial: Partial<RetrievedItem> & Pick<RetrievedItem, "id">): RetrievedItem {
  return {
    text: partial.text ?? partial.id,
    tier: partial.tier ?? "lexical",
    source: partial.source ?? "test",
    score: partial.score ?? 1,
    rankPosition: partial.rankPosition ?? 0,
    authorizationResult: partial.authorizationResult ?? "allowed",
    whyEntered: partial.whyEntered ?? "batch33",
    scopeHash: partial.scopeHash ?? `scope-${randomUUID().slice(0, 6)}`,
    timestamp_iso: partial.timestamp_iso ?? "2026-11-10T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch33", () => {
  it("dedupeRetrievalResults appends to existing mergedLog bucket (172)", () => {
    const body = `shared-b33-${randomUUID().slice(0, 8)}`;
    const root = item({ id: "mem-b33-root", text: body, score: 0.95, rankPosition: 1 });
    const dup1 = item({ id: "mem-b33-root", text: body, score: 0.5, rankPosition: 2 });
    const dup2 = item({ id: "mem-b33-root", text: body, score: 0.2, rankPosition: 3 });
    const result = dedupeRetrievalResults({ items: [root, dup1, dup2] });
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.droppedIds).toEqual(expect.arrayContaining([dup1.id, dup2.id]));
  });

  it("decideMerge treats same-id pair via contentHash merge without derivative (98 guard)", () => {
    const shared = item({ id: "mem-b33-same", text: "same body", tier: "lexical" });
    const twin = item({ id: "mem-b33-same", text: "same body", tier: "lexical", score: 0.4 });
    expect(decideMerge({ existing: shared, candidate: twin }).merge).toBe(true);
  });

  it.skip("buildKey (81) is not referenced from dedupeRetrievalResults — dead code", () => {});
});
