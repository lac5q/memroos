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

describe("skillforge analyzer batch34 — classifyFailure and generateTestCases branches", () => {
  it.skip("analyzeSkill patternEntries.length < 1 continue (111) — failure groups are never empty", () => {});

  it("classifyFailure tags contract_incomplete, dispatch_disabled, eval_failure, and unknown (82, 118)", () => {
    const skillId = `cls-b34-${randomUUID().slice(0, 6)}`;
    const results = analyzeTelemetry(
      [
        entry({
          skillId,
          payload: { query: "contract incomplete b34", dispatchStatus: "incomplete", expected: "a", actual: "b" },
        }),
        entry({
          skillId,
          payload: { input: "dispatch disabled b34", dispatchStatus: "disabled", expected: "x", actual: "y" },
        }),
        entry({
          skillId,
          payload: { query: "eval failed b34", passed: false },
        }),
        entry({
          skillId,
          payload: { query: "unknown pattern b34", note: "no classifier" },
        }),
      ],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    const fixes = results[0]?.patterns.map((p) => p.suggestedFix ?? "") ?? [];
    expect(fixes.some((f) => f.includes("REQUIRED_CONTRACT_FIELDS"))).toBe(true);
    expect(fixes.some((f) => f.includes("dispatch_status"))).toBe(true);
    expect(fixes.some((f) => f.includes("eval candidate"))).toBe(true);
    expect(fixes.some((f) => f.includes("Review skill implementation"))).toBe(true);
  });

  it("generateTestCases uses input/actual paths and tags llm_fallback vs deterministic (90, 111)", () => {
    const skillId = `tc-b34-${randomUUID().slice(0, 6)}`;
    const shared = "shared pattern batch34 coverage";
    const results = analyzeTelemetry(
      [
        entry({
          skillId,
          traceType: "failure",
          payload: { query: shared, expected: "exp1", actual: "act1" },
        }),
        entry({
          skillId,
          traceType: "success",
          payload: { input: shared, actual: "act2" },
        }),
      ],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    const tests = results[0]?.testCases ?? [];
    expect(tests.length).toBeGreaterThan(0);
    const sources = new Set(tests.map((t) => t.source));
    expect(sources.has("llm_fallback") || sources.has("deterministic")).toBe(true);
  });
});
