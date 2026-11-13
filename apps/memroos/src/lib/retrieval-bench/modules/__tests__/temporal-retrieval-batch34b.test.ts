// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { performTemporalRetrieval } from "../temporal-retrieval";

describe("temporal-retrieval batch34b", () => {
  it("hashes supersessionChainId and tie-breaks equal timestamps (branches 96–106)", () => {
    const candidates = [
      { id: "tie-z", text: "z", timestamp_iso: "2026-02-01T00:00:00.000Z", supersessionChainId: "chain-a" } as never,
      { id: "tie-a", text: "a", timestamp_iso: "2026-02-01T00:00:00.000Z", supersessionChainId: "chain-b" } as never,
    ];
    const metadata = { reference_time_iso: "2026-02-02T00:00:00.000Z", temporal_direction: "latest" as const };
    const a = performTemporalRetrieval({ candidates, metadata });
    const b = performTemporalRetrieval({ candidates, metadata });
    expect(a.receipt.timestampHash).toBe(b.receipt.timestampHash);
    expect(a.candidates.map((item) => item.id)).toEqual(["tie-a", "tie-z"]);
    expect(a.caveats.some((c) => c.code === "conflicting_facts")).toBe(true);
  });

  it("covers before/after/between fallbacks and valid-until filtering (branches 183–288)", () => {
    const corpus = [
      { id: "early", text: "early", timestamp_iso: "2026-01-01T00:00:00.000Z" },
      { id: "mid", text: "mid", timestamp_iso: "2026-01-02T00:00:00.000Z" },
      { id: "late", text: "late", timestamp_iso: "2026-01-03T00:00:00.000Z" },
    ];

    const beforeEmpty = performTemporalRetrieval({
      candidates: [{ id: "after-only", text: "after", timestamp_iso: "2026-01-05T00:00:00.000Z" }],
      metadata: { reference_time_iso: "2026-01-01T00:00:00.000Z", temporal_direction: "before" },
    });
    expect(beforeEmpty.selected).toEqual([]);

    const afterPick = performTemporalRetrieval({
      candidates: corpus,
      metadata: { reference_time_iso: "2026-01-01T12:00:00.000Z", temporal_direction: "after" },
    });
    expect(afterPick.selected).toEqual(["mid"]);

    const betweenMissingWindow = performTemporalRetrieval({
      candidates: corpus,
      metadata: { reference_time_iso: "2026-01-01T00:00:00.000Z", temporal_direction: "between" },
    });
    expect(betweenMissingWindow.selected).toEqual([]);
    expect(betweenMissingWindow.caveats.some((c) => c.code === "missing_validity_window")).toBe(true);

    const betweenMidpoint = performTemporalRetrieval({
      candidates: corpus,
      metadata: {
        reference_time_iso: "2026-01-01T00:00:00.000Z",
        fact_valid_until_iso: "2026-01-03T00:00:00.000Z",
        temporal_direction: "between",
      },
    });
    expect(betweenMidpoint.selected).toHaveLength(1);
    expect(["early", "mid", "late"]).toContain(betweenMidpoint.selected[0]);

    const validUntilTrim = performTemporalRetrieval({
      candidates: corpus,
      metadata: {
        reference_time_iso: "2026-01-04T00:00:00.000Z",
        fact_valid_until_iso: "2026-01-02T00:00:00.000Z",
        temporal_direction: "latest",
      },
    });
    expect(validUntilTrim.candidates.map((c) => c.id)).toEqual(["early", "mid"]);
  });
});
