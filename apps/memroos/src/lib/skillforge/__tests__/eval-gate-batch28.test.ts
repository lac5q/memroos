// @vitest-environment node
import { describe, expect, it } from "vitest";

import { computeWDelta, runValidation } from "../eval-gate";
import type { HeldOutResult, SkillForgeProposal, ValidationResult } from "../types";

function validation(score: number): ValidationResult {
  return {
    triggerRoutingAccuracy: score,
    contractCompleteness: score,
    resolverReachability: score,
    overallScore: score,
  };
}

function heldOut(partial: Partial<HeldOutResult>): HeldOutResult {
  return {
    passRate: 0.8,
    tasksRun: 3,
    tasksPassed: 2,
    avgLatencyMs: 1,
    behavioralW: 0.7,
    baselineW: 0.6,
    treatmentW: 0.7,
    scorerVersion: "sandbox-b28",
    sandboxReceipt: { scorerVersion: "sandbox-b28", tasksRun: 3, passRate: 0.8 },
    taskScores: [],
    ...partial,
  };
}

describe("SkillForge eval-gate batch28 — computeWDelta guards", () => {
  it("gates proposals when held-out pass rate is below 50%", () => {
    const result = computeWDelta(validation(0.9), heldOut({ passRate: 0.4, behavioralW: 0.85 }), 0.5);
    expect(result.gated).toBe(true);
    expect(result.reason).toMatch(/pass rate/i);
  });

  it("runValidation scores sparse diffs below structured proposals", () => {
    const sparse: SkillForgeProposal = {
      id: "sparse-b28",
      sealProposalId: null,
      sourceSkillId: "skill-b28",
      sourceVersion: "1.0.0",
      proposedDiff: "minor tweak batch28",
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
    const structured: SkillForgeProposal = {
      ...sparse,
      id: "structured-b28",
      proposedDiff: "## Pattern: batch28\nFix: add trigger\n## Generated Test Cases\n- Input: case",
    };
    const sparseScore = runValidation(null as never, sparse, {
      id: "split",
      skillId: "skill-b28",
      splitType: "validation",
      taskSamples: [],
      createdAt: new Date(),
    }).overallScore;
    const structuredScore = runValidation(null as never, structured, {
      id: "split",
      skillId: "skill-b28",
      splitType: "validation",
      taskSamples: [],
      createdAt: new Date(),
    }).overallScore;
    expect(structuredScore).toBeGreaterThan(sparseScore);
  });
});
