// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildReplayHandle } from "../report-publication";

describe("report-publication batch31b — provider flag comparison", () => {
  it("buildReplayHandle.matches requires identical providerFlags key order (lines 290-292)", () => {
    const handle = buildReplayHandle({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      lane: "architecture_evidence",
      configHash: "sha256:cfg-b31b",
      fixtureHash: "sha256:fix-b31b",
      seed: 7,
      k: 5,
      providerFlags: { mem0: true, sqlite: false },
      rerankEnabled: false,
      judgeEnabled: false,
    });

    const baseReport = {
      dataset: "memroos_public_synthetic" as const,
      adapter: "lexical" as const,
      lane: "architecture_evidence" as const,
      configHash: "sha256:cfg-b31b",
      fixtureHash: "sha256:fix-b31b",
      seed: 7,
      k: 5,
      rerankEnabled: false,
      judgeEnabled: false,
      providerFlags: { mem0: true, sqlite: false },
    };

    expect(handle.matches(baseReport)).toBe(true);
    expect(handle.matches({ ...baseReport, providerFlags: { mem0: true, sqlite: true } })).toBe(false);
    expect(handle.matches({ ...baseReport, providerFlags: { sqlite: false, mem0: true } })).toBe(true);
  });
});
