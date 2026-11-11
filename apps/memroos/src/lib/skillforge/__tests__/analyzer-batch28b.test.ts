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

describe("skillforge analyzer batch28b — eval_failure, unknown, logFailure", () => {
  it("analyzeTelemetry suggests eval alignment fix for passed=false failures", () => {
    const skillId = `eval-b28b-${randomUUID().slice(0, 6)}`;
    const results = analyzeTelemetry(
      [entry({ skillId, payload: { query: "eval failure batch28b", passed: false } })],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    expect(results[0]?.patterns[0]?.suggestedFix).toContain("eval candidate alignment");
  });

  it("analyzeTelemetry uses generic review fix for unknown failure payloads", () => {
    const skillId = `unknown-b28b-${randomUUID().slice(0, 6)}`;
    const results = analyzeTelemetry(
      [entry({ skillId, payload: { query: "mystery batch28b" } })],
      DEFAULT_SKILLFORGE_CONFIG,
    );
    expect(results[0]?.patterns[0]?.suggestedFix).toContain("Review skill implementation");
  });

  it("logFailure no-ops safely when skillforge_failure_log table is absent", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      logFailure(db, {
        operation: "dispatch",
        input: "input-b28b",
        deterministicResult: "fail",
        llmResult: null,
        pattern: "pattern-b28b",
        skillId: `log-b28b-${randomUUID().slice(0, 6)}`,
      }),
    ).not.toThrow();
    db.close();
  });
});
