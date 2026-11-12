// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

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
    whyEntered: partial.whyEntered ?? "batch35",
    scopeHash: partial.scopeHash ?? `scope-${randomUUID().slice(0, 6)}`,
    timestamp_iso: partial.timestamp_iso ?? "2026-11-12T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch35", () => {
  it.skip("buildKey (81) is not referenced from dedupeRetrievalResults — dead code", () => {});

  it("decideMerge merges same id same body (98)", () => {
    const shared = item({ id: "mem-b35-same", text: "same", tier: "lexical" });
    const twin = item({ id: "mem-b35-same", text: "same", tier: "lexical", score: 0.25 });
    expect(decideMerge({ existing: shared, candidate: twin }).merge).toBe(true);
  });

  it("dedupeRetrievalResults appends dropped ids to merged log (172)", () => {
    const body = `dup-body-b35-${randomUUID().slice(0, 6)}`;
    const a = item({ id: "mem-root-b35", text: body, score: 0.9, rankPosition: 1 });
    const b = item({ id: "mem-root-b35", text: body, score: 0.4, rankPosition: 2 });
    const result = dedupeRetrievalResults({ items: [a, b] });
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.droppedIds).toContain("mem-root-b35");
  });

  it("decideMerge rejects when content hashes diverge", () => {
    const left = item({ id: "mem-left-b35", text: "alpha body batch35" });
    const right = item({ id: "mem-right-b35", text: "beta body batch35" });
    expect(decideMerge({ existing: left, candidate: right }).merge).toBe(false);
  });
});
