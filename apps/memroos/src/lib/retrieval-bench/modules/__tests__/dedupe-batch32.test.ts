// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { dedupeRetrievalResults } from "@/lib/retrieval-bench/modules/dedupe";
import type { RetrievedItem } from "@/lib/retrieval-bench/schema";

function item(partial: Partial<RetrievedItem> & Pick<RetrievedItem, "id">): RetrievedItem {
  return {
    text: partial.text ?? partial.id,
    tier: partial.tier ?? "lexical",
    source: partial.source ?? "test",
    score: partial.score ?? 1,
    rankPosition: partial.rankPosition ?? 0,
    authorizationResult: partial.authorizationResult ?? "allowed",
    whyEntered: partial.whyEntered ?? "batch32",
    scopeHash: partial.scopeHash ?? `scope-${randomUUID().slice(0, 6)}`,
    timestamp_iso: partial.timestamp_iso ?? "2026-11-09T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch32 — mergedLog push and buildKey sticky", () => {
  it("dedupeRetrievalResults opens a new mergedLog bucket when absent (172)", () => {
    const body = `shared-b32-${randomUUID().slice(0, 8)}`;
    const first = item({ id: "mem-b32-root", text: body, score: 0.9, rankPosition: 1 });
    const second = item({ id: "mem-b32-root", text: body, score: 0.4, rankPosition: 2 });
    const result = dedupeRetrievalResults({ items: [first, second] });
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.droppedIds).toContain(second.id);
  });

  it.skip("buildKey (81) is not referenced from dedupeRetrievalResults — dead code", () => {});
});
