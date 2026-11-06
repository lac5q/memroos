// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runEvalGate } from "../eval-gate";
import { SKILLFORGE_SANDBOX_SCORER_VERSION } from "../behavioral-sandbox-scorer";
import type { SkillForgeConfig, SkillForgeProposal } from "../types";

const config: SkillForgeConfig = {
  cronSchedule: "0 2 * * *",
  batchSize: 5,
  textualLearningRate: 0.3,
  redactionEnabled: true,
  skillScopeFilter: [],
  minTraceAgeHours: 0,
  maxTraceAgeDays: 30,
};

function makeProposal(skillId: string): SkillForgeProposal {
  return {
    id: `sf-b27-${skillId}`,
    sealProposalId: null,
    sourceSkillId: skillId,
    sourceVersion: "1.0.0",
    proposedDiff:
      "## Pattern: batch27\nFix: add trigger\n## Generated Test Cases\n- Input: alpha case\n- Input: beta case",
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

describe("SkillForge eval-gate batch27 — pending approval path", () => {
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

  it("runEvalGate promotes passing proposals to pending_approval", () => {
    const proposal = makeProposal("skill-b27-pass");
    const result = runEvalGate(db, proposal, config, [
      "alpha case",
      "beta case",
      "gamma case",
      "delta case",
      "epsilon case",
      "zeta case",
    ]);
    expect(result.approved).toBe(true);
    expect(result.reason).toBeNull();
    expect(proposal.status).toBe("pending_approval");
    expect(proposal.evaluatorReceipts?.some((r) => r.evaluator === SKILLFORGE_SANDBOX_SCORER_VERSION)).toBe(true);
  });
});
