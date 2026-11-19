// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  loadBaselineSkillContent,
  scoreProposalInBehavioralSandbox,
  SKILLFORGE_SANDBOX_SCORER_VERSION,
} from "../behavioral-sandbox-scorer";
import type { SkillForgeProposal, SkillForgeSplit } from "../types";

describe("behavioral sandbox scorer", () => {
  it("falls back to stub baseline content when registry is empty", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const body = loadBaselineSkillContent(db, "missing-skill", "1.0.0");
    expect(body).toContain("missing-skill");
    db.close();
  });

  it("scores held-out tasks and emits receipt metadata", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const proposal = {
      sourceSkillId: "skill-a",
      sourceVersion: "1.0.0",
      proposedDiff: "Always mention operator playbook checklist verification steps.",
    } as SkillForgeProposal;
    const split = {
      id: "held-out",
      taskSamples: ["operator playbook checklist verification"],
    } as SkillForgeSplit;

    const result = scoreProposalInBehavioralSandbox(db, proposal, split);
    expect(result.receipt.scorerVersion).toBe(SKILLFORGE_SANDBOX_SCORER_VERSION);
    expect(result.tasksRun).toBe(1);
    expect(result.taskScores[0]?.passed).toBe(true);
    db.close();
  });
});
