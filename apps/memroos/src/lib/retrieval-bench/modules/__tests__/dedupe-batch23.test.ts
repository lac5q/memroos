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
    whyEntered: partial.whyEntered ?? "batch23",
    scopeHash: partial.scopeHash ?? "scope-b23",
    timestamp_iso: partial.timestamp_iso ?? "2026-10-30T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch23 — derivative checks and merge-log reuse", () => {
  it("decideMerge rejects derivative ids when content hashes differ", () => {
    const ts = "2026-10-30T00:00:00.000Z";
    const decision = decideMerge({
      existing: item({ id: "mem-b23", text: "left", scopeHash: "scope-b23", timestamp_iso: ts }),
      candidate: item({ id: "mem-b23_vector", text: "right", scopeHash: "scope-b23", timestamp_iso: ts }),
    });
    expect(decision.merge).toBe(false);
    expect(decision.nonMergeReason).toBe("distinct_canonical_id");
  });

  it("decideMerge does not treat identical ids as derivatives", () => {
    const decision = decideMerge({
      existing: item({ id: "same-id", text: "payload" }),
      candidate: item({ id: "same-id", text: "payload" }),
    });
    expect(decision.merge).toBe(true);
  });

  it("dedupeRetrievalResults appends duplicate drops to an existing merge log entry", () => {
    const shared = "duplicate canonical body batch23";
    const result = dedupeRetrievalResults({
      items: [
        item({ id: "mem-9", text: shared, score: 0.5 }),
        item({ id: "mem-9", text: shared, score: 0.6 }),
        item({ id: "mem-9", text: shared, score: 0.7 }),
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.merged[0]?.droppedIds.length).toBeGreaterThanOrEqual(1);
  });
});
