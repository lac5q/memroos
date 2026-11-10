// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { analyzeTelemetry } from "../analyzer";
import { DEFAULT_SKILLFORGE_CONFIG, type SkillForgeIntakeEntry } from "../types";

function entry(partial: Partial<SkillForgeIntakeEntry>): SkillForgeIntakeEntry {
  return {
    skillId: partial.skillId ?? `skill-${randomUUID().slice(0, 6)}`,
    traceType: partial.traceType ?? "failure",
    payload: partial.payload ?? {},
    timestamp: partial.timestamp ?? new Date().toISOString(),
  };
}

describe("skillforge analyzer batch33 — test case cap and pattern groups", () => {
  it.skip("analyzeSkill patternEntries.length < 1 continue (111) — groupByPattern never yields empty slices", () => {});

  it("generateTestCases stops after three cases per pattern (76)", () => {
    const skillId = `cap-b33-${randomUUID().slice(0, 6)}`;
    const sharedQuery = "shared cap pattern batch33";
    const results = analyzeTelemetry(
      [
        entry({ skillId, payload: { query: sharedQuery, expected: "e1", actual: "a1" } }),
        entry({ skillId, payload: { query: sharedQuery, expected: "e2", actual: "a2" } }),
        entry({ skillId, payload: { query: sharedQuery, expected: "e3", actual: "a3" } }),
        entry({ skillId, payload: { query: sharedQuery, expected: "e4", actual: "a4" } }),
        entry({ skillId, payload: { query: sharedQuery, expected: "e5", actual: "a5" } }),
      ],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    const patternTests = results[0]?.testCases.filter((tc) => tc.patternId.includes("shared cap"));
    expect(patternTests?.length ?? 0).toBeLessThanOrEqual(3);
    expect(results[0]?.testCases.length ?? 0).toBeGreaterThan(0);
  });

  it("analyzeTelemetry tags deterministic vs llm_fallback test sources (90)", () => {
    const skillId = `src-b33-${randomUUID().slice(0, 6)}`;
    const results = analyzeTelemetry(
      [
        entry({ skillId, traceType: "failure", payload: { query: "src batch33", expected: "x", actual: "y" } }),
        entry({ skillId, traceType: "success", payload: { query: "src batch33 ok", expected: "ok", actual: "ok" } }),
      ],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    const sources = new Set(results[0]?.testCases.map((tc) => tc.source));
    expect(sources.has("llm_fallback") || sources.has("deterministic")).toBe(true);
  });
});
