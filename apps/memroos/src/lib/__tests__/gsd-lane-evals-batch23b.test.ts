// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { evaluateGsdLaneCase, runGsdLaneEvalSuite } from "@/lib/gsd/lane-evals";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("gsd-lane-evals batch23b — suite filter and proof_compliance branch", () => {
  it("runGsdLaneEvalSuite honors caseIds filter and empty pass rate", () => {
    const database = freshDb();
    const suite = runGsdLaneEvalSuite(database, {
      caseIds: ["__no_such_case__"],
      persistReceipts: false,
      now: () => new Date("2026-10-30T12:00:00.000Z"),
    });
    expect(suite.totalCases).toBe(0);
    expect(suite.passRate).toBe(1);
    expect(suite.runId).toMatch(/^lane_eval_/);
  });

  it("evaluateGsdLaneCase fails when expected proofCompliant disagrees with metrics", () => {
    const database = freshDb();
    const result = evaluateGsdLaneCase(
      database,
      {
        id: "proof-mismatch-b23b",
        lane: "execution",
        scenario: "proof compliance expectation",
        rubric: { proof_compliance: { weight: 1, minimum: 0 } },
        input: { requiredProof: ["artifact"], proof: {} },
        expected: { proofCompliant: true, minimumScore: 0 },
      },
      false,
    );
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("proof_compliance mismatch");
  });

  it("evaluateGsdLaneCase writes hive_actions receipt when persistReceipt is true", () => {
    const database = freshDb();
    const result = evaluateGsdLaneCase(
      database,
      {
        id: "receipt-b23b",
        lane: "research",
        scenario: "ledger receipt",
        rubric: { source_coverage: { weight: 1, minimum: 0 } },
        input: { sources: ["doc:a"] },
        expected: { minimumScore: 0 },
      },
      true,
    );
    expect(result.ledgerReceiptId).toBeGreaterThan(0);
    const row = database
      .prepare("SELECT action_type FROM hive_actions WHERE rowid = ?")
      .get(result.ledgerReceiptId) as { action_type: string };
    expect(row.action_type).toBe("checkpoint");
  });
});
