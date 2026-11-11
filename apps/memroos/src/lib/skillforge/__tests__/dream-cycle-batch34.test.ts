// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runDreamCycle } from "../dream-cycle";
import { DEFAULT_SKILLFORGE_CONFIG, type SkillForgeProposal } from "../types";
import * as operatorApproval from "../operator-approval";
import * as integration from "../integration";

const { workerRun } = vi.hoisted(() => ({
  workerRun: vi.fn(),
}));

vi.mock("../worker", () => ({
  SkillForgeWorker: class MockSkillForgeWorker {
    run = workerRun;
  },
}));

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE skillforge_proposals (
      id TEXT PRIMARY KEY, seal_proposal_id TEXT, source_skill_id TEXT NOT NULL,
      source_version TEXT NOT NULL, proposed_diff TEXT NOT NULL, status TEXT NOT NULL,
      rejected_edits TEXT NOT NULL DEFAULT '[]', residual_risks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE skill_registry (
      id INTEGER PRIMARY KEY, name TEXT, version TEXT, raw_body TEXT, imported_by TEXT
    );
    CREATE TABLE skillforge_exports (
      id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, skill_id TEXT NOT NULL,
      skill_registry_id INTEGER, created_at TEXT NOT NULL
    );
    CREATE TABLE audit_entries (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      reason TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
  `);
  return db;
}

function proposal(
  partial: Partial<SkillForgeProposal> & { id: string; status: SkillForgeProposal["status"] },
): SkillForgeProposal {
  return {
    id: partial.id,
    sealProposalId: null,
    sourceSkillId: "1",
    sourceVersion: "1.0.0",
    proposedDiff: "diff",
    status: partial.status,
    trainSplitId: null,
    validationSplitId: null,
    heldOutSplitId: null,
    baselineW: 0.5,
    validationW: 0.6,
    heldOutW: 0.7,
    validationResults: null,
    heldOutResults: null,
    wDelta: partial.wDelta ?? null,
    evaluatorReceipts: [],
    typedEditOps: [],
    rejectedEdits: [],
    residualRisks: partial.residualRisks ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("dream-cycle batch34 — gated queue, null wDelta, worker errors (51, 62, 102, 125)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    workerRun.mockReset();
    workerRun.mockResolvedValue({
      runId: "sf-b34",
      startedAt: new Date(),
      completedAt: new Date(),
      status: "success",
      entriesProcessed: 0,
      proposalsCreated: 0,
      proposalsSubmitted: 0,
      errors: [],
    });
    vi.restoreAllMocks();
  });

  it("escalates gated proposals when wDelta is below threshold (51, 62, 125)", async () => {
    const gated = proposal({
      id: `gated-b34-${randomUUID().slice(0, 6)}`,
      status: "gated",
      wDelta: null,
      residualRisks: [],
    });
    vi.spyOn(operatorApproval, "listProposals").mockReturnValue({
      pending: [gated],
      gated: [],
      approved: [],
      rejected: [],
    });
    vi.spyOn(operatorApproval, "applyApprovalAction").mockReturnValue({ success: true, postState: "approved" });
    vi.spyOn(integration, "exportToRuntime").mockReturnValue({ success: false });
    vi.spyOn(operatorApproval, "markApplied");

    const result = await runDreamCycle(db, { ...DEFAULT_SKILLFORGE_CONFIG, minTraceAgeHours: 0 });
    expect(result.autoApproved).toBe(0);
    expect(result.escalated).toBe(1);
    expect(operatorApproval.applyApprovalAction).not.toHaveBeenCalled();
  });

  it("records worker failures in errors array (102)", async () => {
    workerRun.mockRejectedValue(new Error("worker failed batch34"));
    const result = await runDreamCycle(db, { ...DEFAULT_SKILLFORGE_CONFIG, minTraceAgeHours: 0 });
    expect(result.errors).toEqual(["worker failed batch34"]);
    expect(result.report).toContain("worker failed batch34");
  });

  it("escalates when residual risks block auto-approve (125)", async () => {
    const risky = proposal({
      id: `risky-b34-${randomUUID().slice(0, 6)}`,
      status: "pending_approval",
      wDelta: 0.4,
      residualRisks: ["policy"],
    });
    vi.spyOn(operatorApproval, "listProposals").mockReturnValue({
      pending: [risky],
      gated: [],
      approved: [],
      rejected: [],
    });

    const result = await runDreamCycle(db, { ...DEFAULT_SKILLFORGE_CONFIG, minTraceAgeHours: 0 });
    expect(result.escalated).toBe(1);
    expect(result.autoApproved).toBe(0);
  });
});
