// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildReplayHandle } from "../report-publication";

describe("report-publication batch36b — sameProviderFlags sorted key mismatch (291)", () => {
  it("buildReplayHandle.matches rejects when sorted keys differ at the same index", () => {
    const seed = randomUUID().slice(0, 6);
    const handle = buildReplayHandle({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      lane: "architecture_evidence",
      configHash: `sha256:cfg-b36b-${seed}`,
      fixtureHash: `sha256:fix-b36b-${seed}`,
      seed: 36,
      k: 5,
      providerFlags: { mem0: true, sqlite: false },
      rerankEnabled: false,
      judgeEnabled: false,
    });

    const baseReport = {
      dataset: "memroos_public_synthetic" as const,
      adapter: "lexical" as const,
      lane: "architecture_evidence" as const,
      configHash: `sha256:cfg-b36b-${seed}`,
      fixtureHash: `sha256:fix-b36b-${seed}`,
      seed: 36,
      k: 5,
      rerankEnabled: false,
      judgeEnabled: false,
      providerFlags: { mem0: true, sqlite: false },
    };

    expect(
      handle.matches({
        ...baseReport,
        providerFlags: { mem0: true, qdrant: false },
      }),
    ).toBe(false);
  });
});
