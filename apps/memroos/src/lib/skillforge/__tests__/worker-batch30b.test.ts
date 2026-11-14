// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { SkillForgeWorker } from "../worker";
import { DEFAULT_SKILLFORGE_CONFIG } from "../types";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("SkillForgeWorker batch30b", () => {
  it("counts only pending_approval proposals as submitted", async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, version, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(`sf-${randomUUID().slice(0, 6)}`, "codex", "enabled", "1.0.0", "test", now);

    const editGenerator = await import("../edit-generator");
    vi.spyOn(editGenerator, "generateEditProposals").mockReturnValue([
      {
        id: "p-pending",
        sealProposalId: null,
        sourceSkillId: "skill-a",
        sourceVersion: "1.0.0",
        proposedDiff: "diff-a",
        status: "pending_approval",
        trainSplitId: null,
        validationResults: null,
        heldOutResults: null,
        wDelta: null,
        rejectedEdits: [],
        residualRisks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "p-gated",
        sealProposalId: null,
        sourceSkillId: "skill-b",
        sourceVersion: "1.0.0",
        proposedDiff: "diff-b",
        status: "gated",
        trainSplitId: null,
        validationResults: null,
        heldOutResults: null,
        wDelta: null,
        rejectedEdits: [],
        residualRisks: ["blocked"],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const evalGate = await import("../eval-gate");
    vi.spyOn(evalGate, "runEvalGate")
      .mockReturnValueOnce({ approved: true, reason: undefined })
      .mockReturnValueOnce({ approved: false, reason: "eval failed b30b" });

    const worker = new SkillForgeWorker(db, { ...DEFAULT_SKILLFORGE_CONFIG, minTraceAgeHours: 0 });
    const result = await worker.run();
    expect(result.proposalsCreated).toBe(2);
    expect(result.proposalsSubmitted).toBe(1);
  });

  it("getStatus returns zeros when run log table is missing", () => {
    const bare = new Database(":memory:");
    const worker = new SkillForgeWorker(bare, DEFAULT_SKILLFORGE_CONFIG);
    expect(worker.getStatus()).toEqual({ lastRun: null, status: null, entriesProcessed: 0 });
    bare.close();
  });
});
