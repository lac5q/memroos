// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
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

describe("skillforge analyzer batch27 — classifier and test generation edges", () => {
  it("analyzeTelemetry covers contract_incomplete, output_mismatch, and capped generated tests", () => {
    const skillId = `analyze-b27-${randomUUID().slice(0, 6)}`;
    const sharedQuery = "shared output mismatch batch27";
    const results = analyzeTelemetry(
      [
        entry({
          skillId,
          payload: { query: sharedQuery, dispatchStatus: "incomplete" },
        }),
        entry({
          skillId,
          payload: { input: sharedQuery, expected: "want-a", actual: "got-b" },
        }),
        entry({
          skillId,
          payload: { query: `${sharedQuery}-2`, expected: "exp-1", actual: "act-1" },
        }),
        entry({
          skillId,
          payload: { query: `${sharedQuery}-3`, expected: "exp-2", actual: "act-2" },
        }),
        entry({
          skillId,
          payload: { query: `${sharedQuery}-4`, expected: "exp-3", actual: "act-3" },
        }),
        entry({
          skillId,
          payload: { query: `${sharedQuery}-5`, expected: "exp-4", actual: "act-4" },
        }),
      ],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    expect(results).toHaveLength(1);
    const { patterns, testCases } = results[0]!;
    expect(patterns.some((p) => p.suggestedFix?.includes("REQUIRED_CONTRACT_FIELDS"))).toBe(true);
    expect(patterns.some((p) => p.suggestedFix?.includes("trigger matching"))).toBe(true);
    expect(testCases.length).toBeLessThanOrEqual(10);
    expect(testCases.length).toBeGreaterThan(0);
  });

  it("analyzeTelemetry classifies dispatch_disabled failures with a suggested fix", () => {
    const skillId = `disabled-b27-${randomUUID().slice(0, 6)}`;
    const results = analyzeTelemetry(
      [entry({ skillId, payload: { query: "dispatch disabled batch27", dispatchStatus: "disabled" } })],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    expect(results[0]?.patterns[0]?.suggestedFix).toContain("dispatch_status");
  });
});
