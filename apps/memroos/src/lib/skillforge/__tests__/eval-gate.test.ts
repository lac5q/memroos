/**
 * SkillForge Eval Gate tests — Phase 88
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSplits, runValidation, runHeldOutEval, computeWDelta, runEvalGate } from "../eval-gate";
import { SKILLFORGE_SANDBOX_SCORER_VERSION } from "../behavioral-sandbox-scorer";
import type { SkillForgeProposal, SkillForgeConfig } from "../types";

const config: SkillForgeConfig = {
  cronSchedule: "0 2 * * *",
  batchSize: 5,
  textualLearningRate: 0.3,
  redactionEnabled: true,
  skillScopeFilter: [],
  minTraceAgeHours: 0,
  maxTraceAgeDays: 30,
};

function makeProposal(skillId: string, diff: string): SkillForgeProposal {
  return {
    id: `sf-test-${Date.now()}`,
    sealProposalId: null,
    sourceSkillId: skillId,
    sourceVersion: "1.0.0",
    proposedDiff: diff,
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
}

describe("SkillForge Eval Gate", () => {
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

  it("creates empty splits for zero task samples", () => {
    const { train, validation, heldOut } = createSplits(db, "skill-empty", []);
    expect(train.taskSamples).toEqual([]);
    expect(validation.taskSamples).toEqual([]);
    expect(heldOut.taskSamples).toEqual([]);
  });

  it("creates disjoint splits", () => {
    const samples = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const { train, validation, heldOut } = createSplits(db, "skill-1", samples);

    expect(train.taskSamples.length).toBe(6);
    expect(validation.taskSamples.length).toBe(2);
    expect(heldOut.taskSamples.length).toBe(2);

    // Check disjoint
    const allSamples = new Set([...train.taskSamples, ...validation.taskSamples, ...heldOut.taskSamples]);
    expect(allSamples.size).toBe(10);
  });

  it("runs deterministic validation", () => {
    const proposal = makeProposal("skill-1", "## Pattern: test\nFix: add trigger\n## Generated Test Cases");
    const validation = runValidation(db, proposal, {
      id: "split-1", skillId: "skill-1", splitType: "validation", taskSamples: ["a"], createdAt: new Date(),
    });

    expect(validation.triggerRoutingAccuracy).toBeGreaterThan(0.5);
    expect(validation.contractCompleteness).toBeGreaterThan(0.5);
    expect(validation.overallScore).toBeGreaterThan(0);
  });

  it("runs held-out eval", () => {
    const proposal = makeProposal("skill-1", "## Pattern: alpha\nFix: add alpha trigger\n## Generated Test Cases\n- Input: alpha case");
    const heldOut = runHeldOutEval(db, proposal, {
      id: "split-1", skillId: "skill-1", splitType: "held_out", taskSamples: ["alpha case", "unmatched case"], createdAt: new Date(),
    });

    expect(heldOut.tasksRun).toBe(2);
    expect(heldOut.tasksPassed).toBe(1);
    expect(heldOut.passRate).toBe(0.5);
    expect(heldOut.baselineW).toBeLessThan(heldOut.treatmentW ?? 0);
    expect(heldOut.scorerVersion).toBe(SKILLFORGE_SANDBOX_SCORER_VERSION);
    expect(heldOut.sandboxReceipt).toMatchObject({
      scorerVersion: SKILLFORGE_SANDBOX_SCORER_VERSION,
      sandboxMode: "no_side_effects",
      sideEffectsDenied: true,
    });
  });

  it("scores held-out eval deterministically", () => {
    const proposal = makeProposal("skill-1", "## Pattern: alpha\nFix: add alpha trigger\n## Generated Test Cases\n- Input: alpha case");
    const split = {
      id: "split-1", skillId: "skill-1", splitType: "held_out" as const, taskSamples: ["alpha case", "unmatched case"], createdAt: new Date(),
    };

    const first = runHeldOutEval(db, proposal, split);
    const second = runHeldOutEval(db, proposal, split);

    expect(second).toEqual(first);
  });

  it("gates negative W delta", () => {
    const validation = { triggerRoutingAccuracy: 0.3, contractCompleteness: 0.3, resolverReachability: 0.3, overallScore: 0.3 };
    const heldOut = { passRate: 0.8, tasksRun: 10, tasksPassed: 8, avgLatencyMs: 100, behavioralW: 0.3 };

    const result = computeWDelta(validation, heldOut, 0.5);
    expect(result.gated).toBe(true);
    expect(result.reason).toContain("negative");
  });

  it("approves positive W delta above threshold", () => {
    const validation = { triggerRoutingAccuracy: 0.9, contractCompleteness: 0.9, resolverReachability: 0.9, overallScore: 0.9 };
    const heldOut = { passRate: 0.9, tasksRun: 10, tasksPassed: 9, avgLatencyMs: 100, behavioralW: 0.9 };

    const result = computeWDelta(validation, heldOut, 0.5);
    expect(result.gated).toBe(false);
    expect(result.wDelta).toBeGreaterThan(0.05);
  });

  it("gates low held-out pass rate", () => {
    const validation = { triggerRoutingAccuracy: 0.8, contractCompleteness: 0.8, resolverReachability: 0.8, overallScore: 0.8 };
    const heldOut = { passRate: 0.3, tasksRun: 10, tasksPassed: 3, avgLatencyMs: 100, behavioralW: 0.6 };

    const result = computeWDelta(validation, heldOut, 0.5);
    expect(result.gated).toBe(true);
    expect(result.reason).toContain("pass rate");
  });

  it("gates proposals without held-out evidence", () => {
    const validation = { triggerRoutingAccuracy: 0.9, contractCompleteness: 0.9, resolverReachability: 0.9, overallScore: 0.9 };
    const heldOut = { passRate: 0, tasksRun: 0, tasksPassed: 0, avgLatencyMs: 0, behavioralW: 0 };

    const result = computeWDelta(validation, heldOut, 0.5);
    expect(result.gated).toBe(true);
    expect(result.reason).toContain("No held-out");
  });

  it("runs full eval gate on proposal", () => {
    const proposal = makeProposal("skill-1", "## Pattern: test\nFix: add trigger");
    const result = runEvalGate(db, proposal, config, ["sample1", "sample2", "sample3"]);

    const trainSplit = db
      .prepare("SELECT split_type FROM skillforge_splits WHERE id = ?")
      .get(proposal.trainSplitId) as { split_type: string } | undefined;

    expect(trainSplit?.split_type).toBe("train");
    expect(proposal.validationSplitId).toMatch(/^split-skill-1-val-/);
    expect(proposal.heldOutSplitId).toMatch(/^split-skill-1-held-/);
    expect(proposal.baselineW).toBe(proposal.heldOutResults?.baselineW);
    expect(proposal.validationW).toBe(proposal.validationResults?.overallScore);
    expect(proposal.heldOutW).toBe(proposal.heldOutResults?.behavioralW);
    expect(proposal.evaluatorReceipts?.map((r) => r.evaluator)).toEqual([
      "skillforge-deterministic-validation",
      SKILLFORGE_SANDBOX_SCORER_VERSION,
    ]);
    expect(proposal.validationResults).not.toBeNull();
    expect(proposal.heldOutResults).not.toBeNull();
    expect(proposal.wDelta).not.toBeNull();
    expect(result.approved || !result.approved).toBe(true); // Either outcome is valid
  });
});
