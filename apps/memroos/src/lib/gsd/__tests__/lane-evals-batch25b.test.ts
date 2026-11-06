// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { evaluateGsdLaneCase, loadGsdLaneEvalCases, runGsdLaneEvalSuite } from "../lane-evals";

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

describe("lane-evals batch25b — receipt opt-out and suite filters", () => {
  it("evaluateGsdLaneCase skips ledger receipt when persistReceipt is false", () => {
    const database = freshDb();
    const result = evaluateGsdLaneCase(
      database,
      {
        id: "synthetic-pass-b25b",
        lane: "engineering",
        scenario: "proof present",
        rubric: { proof_compliance: { weight: 1, minimum: 1 } },
        input: { requiredProof: ["tests_green"], proof: { tests_green: true }, sources: ["repo"] },
        expected: { proofCompliant: true, sourceCoverage: 1, minimumScore: 0.5 },
      },
      false,
    );
    expect(result.passed).toBe(true);
    expect(result.ledgerReceiptId).toBeUndefined();
    const count = database.prepare(`SELECT COUNT(*) AS c FROM hive_actions`).get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("runGsdLaneEvalSuite honors persistReceipts false and caseIds filter", () => {
    const database = freshDb();
    const first = loadGsdLaneEvalCases()[0]!;
    const suite = runGsdLaneEvalSuite(database, {
      caseIds: [first.id],
      persistReceipts: false,
      now: () => new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(suite.totalCases).toBe(1);
    expect(suite.results[0]?.ledgerReceiptId).toBeUndefined();
    expect(suite.runId).toMatch(/^lane_eval_/);
  });
});
