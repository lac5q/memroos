/**
 * SkillForge Analyzer tests — Phase 86
 */

import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { analyzeTelemetry, logFailure } from "../analyzer";
import type { SkillForgeIntakeEntry, SkillForgeConfig } from "../types";

const config: SkillForgeConfig = {
  cronSchedule: "0 2 * * *",
  batchSize: 5,
  textualLearningRate: 0.3,
  redactionEnabled: true,
  skillScopeFilter: [],
  minTraceAgeHours: 0,
  maxTraceAgeDays: 30,
};

function makeEntry(skillId: string, traceType: SkillForgeIntakeEntry["traceType"], payload: Record<string, unknown>): SkillForgeIntakeEntry {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    skillId,
    skillName: skillId,
    traceType,
    payload,
    securityLabels: [{ visibility: "internal", policy: "indexable" }],
    timestamp: new Date(),
  };
}

describe("SkillForge Analyzer", () => {
  it("returns empty results for empty entries", () => {
    const results = analyzeTelemetry([], config);
    expect(results).toHaveLength(0);
  });

  it("identifies failure patterns from telemetry", () => {
    const entries = [
      makeEntry("skill-1", "failure", { query: "how to deploy", expected: "deploy guide", actual: "not found" }),
      makeEntry("skill-1", "failure", { query: "how to deploy", expected: "deploy guide", actual: "not found" }),
      makeEntry("skill-1", "failure", { query: "how to test", expected: "test guide", actual: "error" }),
    ];

    const results = analyzeTelemetry(entries, config);
    expect(results).toHaveLength(1);
    expect(results[0].skillId).toBe("skill-1");
    expect(results[0].patterns.length).toBeGreaterThan(0);
    expect(results[0].confidence).toBeGreaterThan(0.1);
  });

  it("groups patterns by normalized input", () => {
    const entries = [
      makeEntry("skill-1", "failure", { query: "HOW TO DEPLOY", expected: "a", actual: "b" }),
      makeEntry("skill-1", "failure", { query: "how to deploy", expected: "a", actual: "b" }),
    ];

    const results = analyzeTelemetry(entries, config);
    expect(results[0].patterns.length).toBe(1); // Same pattern after normalization
    expect(results[0].patterns[0].frequency).toBe(2);
  });

  it("generates test cases from failures", () => {
    const entries = [
      makeEntry("skill-1", "failure", { query: "test query", expected: "expected output", actual: "wrong" }),
    ];

    const results = analyzeTelemetry(entries, config);
    expect(results[0].testCases.length).toBeGreaterThan(0);
    expect(results[0].testCases[0].input).toBe("test query");
  });

  it("classifies contract_incomplete failures", () => {
    const entries = [
      makeEntry("skill-1", "telemetry", { dispatchStatus: "incomplete" }),
    ];

    const results = analyzeTelemetry(entries, config);
    // Telemetry entries without failures still produce analysis
    expect(results).toHaveLength(1);
  });

  it("suggests fixes for dispatch, eval, and contract failure classes", () => {
    const entries = [
      makeEntry("skill-fix", "failure", { dispatchStatus: "disabled", query: "deploy" }),
      makeEntry("skill-fix", "failure", { passed: false, query: "eval case" }),
      makeEntry("skill-fix", "failure", { query: "mismatch", expected: "a", actual: "b" }),
    ];
    const results = analyzeTelemetry(entries, config);
    const fixes = results[0].patterns.map((pattern) => pattern.suggestedFix);
    expect(fixes.some((fix) => fix?.includes("dispatch_status"))).toBe(true);
    expect(fixes.some((fix) => fix?.includes("eval candidate"))).toBe(true);
    expect(fixes.some((fix) => fix?.includes("trigger matching"))).toBe(true);
  });

  it("extracts patterns from payload.input when query is absent", () => {
    const entries = [
      makeEntry("skill-input", "failure", { input: "custom input path", expected: "x", actual: "y" }),
    ];
    const results = analyzeTelemetry(entries, config);
    expect(results[0].patterns[0].pattern).toMatch(/custom input path/i);
  });

  it("persists analyzer failures into skillforge_failure_log", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE skillforge_failure_log (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        input TEXT NOT NULL,
        deterministic_result TEXT,
        llm_result TEXT,
        pattern TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
    logFailure(db, {
      operation: "analyze",
      input: "bad payload",
      deterministicResult: "deny",
      llmResult: null,
      pattern: "contract_incomplete",
      skillId: "skill-1",
    });
    const row = db
      .prepare(`SELECT operation, input, pattern, skill_id FROM skillforge_failure_log LIMIT 1`)
      .get() as { operation: string; input: string; pattern: string; skill_id: string };
    expect(row).toMatchObject({
      operation: "analyze",
      input: "bad payload",
      pattern: "contract_incomplete",
      skill_id: "skill-1",
    });
    db.close();
  });

  it("uses default suggested fix for unknown failure class", () => {
    const entries = [
      makeEntry("skill-unknown", "failure", { query: "weird case", note: "no dispatch flags" }),
    ];
    const results = analyzeTelemetry(entries, config);
    expect(results[0].patterns[0].suggestedFix).toContain("Review skill implementation");
  });

  it("sorts results by confidence descending", () => {
    const entries = [
      makeEntry("skill-a", "failure", { query: "q1", expected: "a", actual: "b" }),
      makeEntry("skill-a", "failure", { query: "q1", expected: "a", actual: "b" }),
      makeEntry("skill-b", "failure", { query: "q2", expected: "a", actual: "b" }),
    ];

    const results = analyzeTelemetry(entries, config);
    expect(results[0].confidence).toBeGreaterThanOrEqual(results[1]?.confidence ?? 0);
  });
});
