// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import {
  loadBaselineSkillContent,
  scoreProposalInBehavioralSandbox,
} from "../behavioral-sandbox-scorer";
import type { SkillForgeProposal, SkillForgeSplit } from "../types";

describe("behavioral sandbox scorer batch31", () => {
  it("scores zero when held-out task has no matchable tokens (line 53)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const proposal = {
      sourceSkillId: "skill-b31",
      sourceVersion: "1.0.0",
      proposedDiff: "No overlap with punctuation-only samples.",
    } as SkillForgeProposal;
    const split = {
      id: "held-out-b31",
      taskSamples: ["!!!", "..."],
    } as SkillForgeSplit;

    const result = scoreProposalInBehavioralSandbox(db, proposal, split);
    expect(result.taskScores.every((s) => s.treatmentScore === 0)).toBe(true);
    db.close();
  });

  it("reads skill_registry raw_body when present (lines 80–96)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = `skill-b31-${randomUUID().slice(0, 8)}`;
    const body = "Operator playbook checklist verification steps for batch31.";
    db.prepare(
      `INSERT INTO skill_registry (name, raw_body, source_harness, dispatch_status, imported_by, imported_at)
       VALUES (?, ?, 'vitest', 'enabled', 'batch31', datetime('now'))`,
    ).run(skillId, body);

    expect(loadBaselineSkillContent(db, skillId, "2.0.0")).toContain("Operator playbook");
    db.close();
  });

  it("tableHasColumn returns false for missing tables (line 70)", () => {
    const db = new Database(":memory:");
    expect(loadBaselineSkillContent(db, "no-table-b31", "0.1.0")).toContain("no-table-b31");
    db.close();
  });
});
