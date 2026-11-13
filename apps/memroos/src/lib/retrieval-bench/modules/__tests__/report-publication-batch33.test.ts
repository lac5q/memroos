// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildReplayHandle } from "../report-publication";

describe("report-publication batch33 — sameProviderFlags key/value parity (290–292)", () => {
  it("buildReplayHandle.matches rejects providerFlags with differing values at same sorted key", () => {
    const seed = randomUUID().slice(0, 6);
    const handle = buildReplayHandle({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      lane: "architecture_evidence",
      configHash: `sha256:cfg-b33-${seed}`,
      fixtureHash: `sha256:fix-b33-${seed}`,
      seed: 33,
      k: 5,
      providerFlags: { mem0: true, sqlite: false },
      rerankEnabled: false,
      judgeEnabled: false,
    });

    const baseReport = {
      dataset: "memroos_public_synthetic" as const,
      adapter: "lexical" as const,
      lane: "architecture_evidence" as const,
      configHash: `sha256:cfg-b33-${seed}`,
      fixtureHash: `sha256:fix-b33-${seed}`,
      seed: 33,
      k: 5,
      rerankEnabled: false,
      judgeEnabled: false,
      providerFlags: { mem0: true, sqlite: false },
    };

    expect(handle.matches(baseReport)).toBe(true);
    expect(
      handle.matches({
        ...baseReport,
        providerFlags: { mem0: false, sqlite: false },
      }),
    ).toBe(false);
    expect(
      handle.matches({
        ...baseReport,
        providerFlags: { extra: true, mem0: true, sqlite: false },
      }),
    ).toBe(false);
  });
});
