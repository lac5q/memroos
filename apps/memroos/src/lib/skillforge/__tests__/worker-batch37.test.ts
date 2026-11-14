// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { SkillForgeWorker } from "../worker";
import { DEFAULT_SKILLFORGE_CONFIG } from "../types";
import type { SkillForgeIntakeEntry, SkillForgeProposal } from "../types";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("SkillForgeWorker batch37", () => {
  it("maps analysis test case inputs into runEvalGate samples (stmt 77)", async () => {
    const intake = await import("../intake");
    const analyzer = await import("../analyzer");
    const editGenerator = await import("../edit-generator");
    const evalGate = await import("../eval-gate");

    const entry: SkillForgeIntakeEntry = {
      id: "entry-b37",
      skillId: "skill-b37",
      skillName: "skill-b37",
      traceType: "dispatch",
      payload: { query: "batch37 query" },
      securityLabels: [],
      timestamp: new Date("2026-03-01T00:00:00.000Z"),
    };

    vi.spyOn(intake, "runIntakePipeline").mockReturnValue({
      entries: [entry],
      redacted: 0,
      filtered: 0,
      deduplicated: 0,
    });

    vi.spyOn(analyzer, "analyzeTelemetry").mockReturnValue([
      {
        skillId: "skill-b37",
        patterns: [],
        testCases: [
          {
            id: "tc-b37",
            input: "batch37-input",
            expectedOutput: "expected",
            patternId: "pattern-b37",
            source: "deterministic",
          },
        ],
        confidence: 0.9,
      },
    ]);

    const proposal: SkillForgeProposal = {
      id: "proposal-b37",
      sealProposalId: null,
      sourceSkillId: "skill-b37",
      sourceVersion: "1.0.0",
      proposedDiff: "diff-b37",
      status: "pending_approval",
      trainSplitId: null,
      validationResults: null,
      heldOutResults: null,
      wDelta: null,
      rejectedEdits: [],
      residualRisks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(editGenerator, "generateEditProposals").mockReturnValue([proposal]);
    const runEvalGateSpy = vi.spyOn(evalGate, "runEvalGate").mockReturnValue({ approved: true, reason: undefined });

    const worker = new SkillForgeWorker(db, { ...DEFAULT_SKILLFORGE_CONFIG, minTraceAgeHours: 0 });
    const result = await worker.run();

    expect(result.proposalsCreated).toBe(1);
    expect(runEvalGateSpy).toHaveBeenCalled();
    expect(runEvalGateSpy.mock.calls[0]?.[3]).toEqual(["batch37-input"]);
  });
});