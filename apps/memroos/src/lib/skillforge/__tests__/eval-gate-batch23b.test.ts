// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeWDelta, createSplits, runValidation } from "../eval-gate";
import type { SkillForgeProposal } from "../types";

describe("SkillForge eval-gate batch23b — small splits and threshold branches", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS skillforge_splits (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        split_type TEXT NOT NULL,
        task_samples TEXT,
        created_at TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("createSplits allocates single-sample and two-sample partitions", () => {
    const one = createSplits(db, "skill-one", ["only"]);
    expect(one.train.taskSamples).toEqual(["only"]);
    expect(one.validation.taskSamples).toEqual([]);
    expect(one.heldOut.taskSamples).toEqual([]);

    const two = createSplits(db, "skill-two", ["a", "b"]);
    expect(two.train.taskSamples).toEqual(["a"]);
    expect(two.validation.taskSamples).toEqual(["b"]);
    expect(two.heldOut.taskSamples).toEqual([]);
  });

  it("runValidation scores sparse diffs below pattern-rich diffs", () => {
    const sparse: SkillForgeProposal = {
      id: "p-sparse",
      sealProposalId: null,
      sourceSkillId: "s1",
      sourceVersion: "1",
      proposedDiff: "minor tweak",
      status: "pending",
      trainSplitId: null,
      validationResults: null,
      heldOutResults: null,
      wDelta: null,
      rejectedEdits: [],
      residualRisks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const rich: SkillForgeProposal = {
      ...sparse,
      id: "p-rich",
      proposedDiff: "## Pattern: x\nFix: y\n## Generated Test Cases\n- t",
    };
    const split = {
      id: "split-v",
      skillId: "s1",
      splitType: "validation" as const,
      taskSamples: ["t"],
      createdAt: new Date(),
    };
    const sparseScore = runValidation(db, sparse, split).overallScore;
    const richScore = runValidation(db, rich, split).overallScore;
    expect(richScore).toBeGreaterThan(sparseScore);
  });

  it("computeWDelta gates improvement below 0.05 when pass rate is acceptable", () => {
    const validation = {
      triggerRoutingAccuracy: 0.51,
      contractCompleteness: 0.51,
      resolverReachability: 0.51,
      overallScore: 0.51,
    };
    const heldOut = {
      passRate: 0.9,
      tasksRun: 5,
      tasksPassed: 4,
      avgLatencyMs: 10,
      behavioralW: 0.51,
    };
    const result = computeWDelta(validation, heldOut, 0.5);
    expect(result.gated).toBe(true);
    expect(result.reason).toMatch(/below improvement threshold/i);
  });
});
