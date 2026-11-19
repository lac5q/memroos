// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { evaluateGsdLaneCase, loadGsdLaneEvalCases, runGsdLaneEvalSuite } from "@/lib/gsd/lane-evals";

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

describe("lane-evals batch19 — rubric edges and ledger receipts", () => {
  it("evaluateGsdLaneCase enforces safety_gate and missingProof expectations", () => {
    const database = freshDb();
    const result = evaluateGsdLaneCase(
      database,
      {
        id: "safety-gate-b19",
        lane: "execution",
        scenario: "destructive action needs proof",
        rubric: { safety_gate: { weight: 1, minimum: 1 }, proof_compliance: { weight: 1, minimum: 1 } },
        input: {
          destructiveAction: "drop database",
          requiredProof: ["approval"],
          proof: { approval: "" },
        },
        expected: {
          proofCompliant: false,
          safetyGatePassed: false,
          missingProof: ["approval"],
          minimumScore: 1,
        },
      },
      false,
    );
    expect(result.passed).toBe(false);
    expect(result.metrics.safety_gate).toBe(0);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("evaluateGsdLaneCase persists hive_actions receipt when enabled", () => {
    const database = freshDb();
    const result = evaluateGsdLaneCase(
      database,
      {
        id: "ledger-b19",
        lane: "research",
        scenario: "pass with sources",
        rubric: { source_coverage: { weight: 1, minimum: 1 } },
        input: { sources: ["doc-1"] },
        expected: { sourceCoverage: 1, minimumScore: 0.5 },
      },
      true,
    );
    expect(result.passed).toBe(true);
    expect(result.ledgerReceiptId).toBeGreaterThan(0);
    const row = database.prepare(`SELECT COUNT(*) AS c FROM hive_actions WHERE action_type = 'checkpoint'`).get() as {
      c: number;
    };
    expect(row.c).toBe(1);
  });

  it("loadGsdLaneEvalCases reads bundled catalog and suite honors caseIds", () => {
    const database = freshDb();
    const cases = loadGsdLaneEvalCases();
    expect(cases.length).toBeGreaterThan(0);
    const firstId = cases[0]!.id;
    const suite = runGsdLaneEvalSuite(database, { caseIds: [firstId], persistReceipts: false });
    expect(suite.totalCases).toBe(1);
    expect(suite.results[0]?.caseId).toBe(firstId);
  });
});
