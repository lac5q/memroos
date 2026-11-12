// @vitest-environment node
import { describe, expect, it } from "vitest";

import { performTemporalRetrieval } from "../temporal-retrieval";

describe("temporal-retrieval batch35b", () => {
  it("after direction picks earliest item after reference (267-273)", () => {
    const result = performTemporalRetrieval({
      candidates: [
        { id: "a1-b35b", text: "a1", timestamp_iso: "2026-02-01T00:00:00.000Z" },
        { id: "a2-b35b", text: "a2", timestamp_iso: "2026-02-10T00:00:00.000Z" },
      ],
      metadata: { reference_time_iso: "2026-01-31T00:00:00.000Z", temporal_direction: "after" },
    });
    expect(result.selected).toEqual(["a1-b35b"]);
  });

  it("between direction without valid_until emits missing_validity_window (191-197)", () => {
    const result = performTemporalRetrieval({
      candidates: [{ id: "between-b35b", text: "mid", timestamp_iso: "2026-03-05T00:00:00.000Z" }],
      metadata: { reference_time_iso: "2026-03-10T00:00:00.000Z", temporal_direction: "between" },
    });
    expect(result.caveats.some((c) => c.code === "missing_validity_window")).toBe(true);
  });

  it("conflicting_facts caveat when candidates share timestamps (238-245)", () => {
    const stamp = "2026-03-05T00:00:00.000Z";
    const result = performTemporalRetrieval({
      candidates: [
        { id: "cf1-b35b", text: "a", timestamp_iso: stamp },
        { id: "cf2-b35b", text: "b", timestamp_iso: stamp },
      ],
      metadata: { reference_time_iso: "2026-03-10T00:00:00.000Z", temporal_direction: "latest" },
    });
    expect(result.caveats.some((c) => c.code === "conflicting_facts")).toBe(true);
  });
});
