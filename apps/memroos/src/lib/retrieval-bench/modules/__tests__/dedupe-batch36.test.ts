// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { dedupeRetrievalResults, decideMerge } from "@/lib/retrieval-bench/modules/dedupe";
import type { RetrievedItem } from "@/lib/retrieval-bench/schema";

function item(partial: Partial<RetrievedItem> & Pick<RetrievedItem, "id">): RetrievedItem {
  const scope = partial.scopeHash ?? `scope-b36-${randomUUID().slice(0, 6)}`;
  return {
    text: partial.text ?? partial.id,
    tier: partial.tier ?? "vector-local",
    source: partial.source ?? "test",
    score: partial.score ?? 1,
    rankPosition: partial.rankPosition ?? 0,
    authorizationResult: partial.authorizationResult ?? "allowed",
    whyEntered: partial.whyEntered ?? "batch36",
    scopeHash: scope,
    timestamp_iso: partial.timestamp_iso ?? "2026-11-13T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch36", () => {
  it.skip("buildKey (81) — no runtime call sites", () => {});

  it("isExactDerivative evaluates prefix ids before content-hash fallback (98-100)", () => {
    const sharedScope = `scope-deriv-b36-${randomUUID().slice(0, 6)}`;
    const body = `derivative-body-b36-${randomUUID().slice(0, 6)}`;
    const root = item({
      id: "mem-root-b36",
      text: body,
      tier: "vector-local",
      scopeHash: sharedScope,
    });
    const vector = item({
      id: "mem-root-b36-vector",
      text: `${body}-variant`,
      tier: "vector-local",
      scopeHash: sharedScope,
    });
    const decision = decideMerge({ existing: root, candidate: vector });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_canonical_id");
  });

  it("dedupeRetrievalResults appends dropped ids on repeated same-id merges (172)", () => {
    const body = `dup-body-b36-${randomUUID().slice(0, 6)}`;
    const a = item({ id: "mem-root-b36", text: body, score: 0.9, rankPosition: 1 });
    const b = item({ id: "mem-root-b36", text: body, score: 0.5, rankPosition: 2 });
    const result = dedupeRetrievalResults({ items: [a, b] });
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.droppedIds).toContain("mem-root-b36");
  });
});
