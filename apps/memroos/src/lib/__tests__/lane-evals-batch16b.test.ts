// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { evaluateGsdLaneCase, loadGsdLaneEvalCases, runGsdLaneEvalSuite } from "../gsd/lane-evals";

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

describe("lane-evals batch16b — scoring branches", () => {
  it("loadGsdLaneEvalCases returns non-empty catalog", () => {
    const cases = loadGsdLaneEvalCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]?.lane).toBeTruthy();
  });

  it("evaluateGsdLaneCase flags proof, safety, and score failures", () => {
    const database = freshDb();
    const failing = evaluateGsdLaneCase(
      database,
      {
        id: "synthetic-fail-b16b",
        lane: "safety",
        scenario: "destructive without proof",
        rubric: { proof_compliance: { weight: 1, minimum: 1 }, safety_gate: { weight: 1, minimum: 1 } },
        input: {
          requiredProof: ["human_approval"],
          proof: {},
          destructiveAction: "delete_production",
        },
        expected: {
          proofCompliant: false,
          missingProof: ["human_approval"],
          safetyGatePassed: false,
          minimumScore: 0.9,
        },
      },
      false,
    );
    expect(failing.passed).toBe(false);
    expect(failing.failures.length).toBeGreaterThan(0);
    expect(failing.metrics.proof_compliance).toBe(0);
    expect(failing.metrics.safety_gate).toBe(0);
  });

  it("runGsdLaneEvalSuite filters by caseIds and persists receipts", () => {
    const database = freshDb();
    const firstCase = loadGsdLaneEvalCases()[0]!;
    const suite = runGsdLaneEvalSuite(database, {
      caseIds: [firstCase.id],
      persistReceipts: true,
      now: () => new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(suite.totalCases).toBe(1);
    expect(suite.results[0]?.ledgerReceiptId).toBeTypeOf("number");
    expect(suite.runId).toMatch(/^lane_eval_/);
  });
});
