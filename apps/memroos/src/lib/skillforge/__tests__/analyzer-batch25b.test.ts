// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { analyzeTelemetry, logFailure } from "../analyzer";
import { DEFAULT_SKILLFORGE_CONFIG, type SkillForgeIntakeEntry } from "../types";

function entry(partial: Partial<SkillForgeIntakeEntry>): SkillForgeIntakeEntry {
  return {
    skillId: partial.skillId ?? `skill-${randomUUID().slice(0, 6)}`,
    traceType: partial.traceType ?? "failure",
    payload: partial.payload ?? {},
    timestamp: partial.timestamp ?? new Date().toISOString(),
  };
}

describe("skillforge analyzer batch25b — failure classes and logging", () => {
  it("analyzeTelemetry surfaces suggested fixes for dispatch and eval failures", () => {
    const skillId = `analyze-b25b-${randomUUID().slice(0, 6)}`;
    const results = analyzeTelemetry(
      [
        entry({
          skillId,
          payload: { query: "trigger mismatch batch25b", dispatchStatus: "disabled" },
        }),
        entry({
          skillId,
          payload: { input: "eval fail batch25b", passed: false },
        }),
        entry({
          skillId,
          payload: { query: "unknown batch25b", note: "no classifier" },
        }),
      ],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    expect(results).toHaveLength(1);
    const patterns = results[0]!.patterns;
    expect(patterns.some((p) => p.suggestedFix?.includes("dispatch_status"))).toBe(true);
    expect(patterns.some((p) => p.suggestedFix?.includes("eval candidate"))).toBe(true);
    expect(results[0]!.confidence).toBeGreaterThan(0);
  });

  it("logFailure swallows missing skillforge_failure_log table", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE IF EXISTS skillforge_failure_log");
    expect(() =>
      logFailure(db, {
        operation: "analyze",
        input: "batch25b",
        deterministicResult: null,
        llmResult: null,
        pattern: "pat",
        skillId: "skill-x",
      }),
    ).not.toThrow();
    db.close();
  });
});
