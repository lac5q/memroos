// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { dedupeRetrievalResults } from "@/lib/retrieval-bench/modules/dedupe";
import type { RetrievedItem } from "@/lib/retrieval-bench/schema";

function item(partial: Partial<RetrievedItem> & Pick<RetrievedItem, "id">): RetrievedItem {
  const scope = partial.scopeHash ?? `scope-b37-${randomUUID().slice(0, 6)}`;
  return {
    text: partial.text ?? partial.id,
    tier: partial.tier ?? "vector-local",
    source: partial.source ?? "test",
    score: partial.score ?? 1,
    rankPosition: partial.rankPosition ?? 0,
    authorizationResult: partial.authorizationResult ?? "allowed",
    whyEntered: partial.whyEntered ?? "batch37",
    scopeHash: scope,
    timestamp_iso: partial.timestamp_iso ?? "2026-11-14T00:00:00.000Z",
    ...partial,
  };
}

describe("retrieval dedupe batch37", () => {
  it.skip("buildKey (80-81) — private helper with no call sites in module", () => {});

  it("dedupeRetrievalResults does not duplicate dropped id entries (171-172)", () => {
    const body = `dup-body-b37-${randomUUID().slice(0, 6)}`;
    const sharedId = "mem-dup-b37";
    const items = [
      item({ id: sharedId, text: body, score: 0.95, rankPosition: 1 }),
      item({ id: sharedId, text: body, score: 0.7, rankPosition: 2 }),
      item({ id: sharedId, text: body, score: 0.4, rankPosition: 3 }),
    ];
    const result = dedupeRetrievalResults({ items });
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.droppedIds.filter((id) => id === sharedId)).toHaveLength(1);
  });
});