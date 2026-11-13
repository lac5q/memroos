// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { performTemporalRetrieval } from "../temporal-retrieval";

describe("temporal-retrieval batch35", () => {
  it.skip("no_reference_time (146–152) — nowIso fallback always supplies a reference", () => {});

  it("emits no_timestamps when corpus lacks parseable timestamps (171–176)", () => {
    const id = `no-ts-b35-${randomUUID().slice(0, 6)}`;
    const result = performTemporalRetrieval({
      candidates: [{ id, text: "missing ts" }],
      metadata: { reference_time_iso: "2026-02-01T00:00:00.000Z", temporal_direction: "latest" },
    });
    expect(result.caveats.some((c) => c.code === "no_timestamps")).toBe(true);
    expect(result.status).toBe("abstain");
  });

  it("truncates oversized candidate sets (249–257)", () => {
    const corpus = Array.from({ length: 40 }, (_, i) => ({
      id: `t-b35-${i}`,
      text: `fact ${i}`,
      timestamp_iso: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const result = performTemporalRetrieval({
      candidates: corpus,
      metadata: { reference_time_iso: "2026-02-01T00:00:00.000Z", temporal_direction: "latest" },
      options: { maxCandidates: 5 },
    });
    expect(result.receipt.truncated).toBe(true);
    expect(result.caveats.some((c) => c.code === "direction_underspecified")).toBe(true);
  });

  it("candidate_stale caveat when items predate cutoff (212–220)", () => {
    const result = performTemporalRetrieval({
      candidates: [
        { id: "stale-b35", text: "old", timestamp_iso: "2025-12-01T00:00:00.000Z" },
        { id: "fresh-b35", text: "new", timestamp_iso: "2026-01-31T23:00:00.000Z" },
      ],
      metadata: { reference_time_iso: "2026-02-01T00:00:00.000Z", temporal_direction: "latest" },
    });
    expect(result.caveats.some((c) => c.code === "candidate_stale")).toBe(true);
    expect(result.status).toBe("caveat");
  });

  it("latest direction picks final sorted candidate (264–266)", () => {
    const result = performTemporalRetrieval({
      candidates: [
        { id: "early-b35", text: "e", timestamp_iso: "2026-01-01T00:00:00.000Z" },
        { id: "late-b35", text: "l", timestamp_iso: "2026-01-20T00:00:00.000Z" },
      ],
      metadata: { reference_time_iso: "2026-02-01T00:00:00.000Z", temporal_direction: "latest" },
    });
    expect(result.selected).toEqual(["late-b35"]);
  });

  it("before direction chooses last item before reference (267–273)", () => {
    const result = performTemporalRetrieval({
      candidates: [
        { id: "b1-b35", text: "b1", timestamp_iso: "2026-01-10T00:00:00.000Z" },
        { id: "b2-b35", text: "b2", timestamp_iso: "2026-01-15T00:00:00.000Z" },
      ],
      metadata: { reference_time_iso: "2026-01-20T00:00:00.000Z", temporal_direction: "before" },
    });
    expect(result.selected).toEqual(["b2-b35"]);
  });
});
