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

describe("lane-evals batch18b", () => {
  it("evaluateGsdLaneCase flags grounded claim count mismatches", () => {
    const database = freshDb();
    const result = evaluateGsdLaneCase(
      database,
      {
        id: "grounded-mismatch-b18b",
        lane: "research",
        scenario: "claims need sources",
        rubric: { claim_grounding: { weight: 1, minimum: 1 } },
        input: {
          claims: [
            { text: "Unsourced", source: "" },
            { text: "Sourced", source: "doc-1" },
          ],
        },
        expected: { groundedClaims: 2, minimumScore: 0.9 },
      },
      false,
    );
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("grounded claim"))).toBe(true);
  });

  it("runGsdLaneEvalSuite returns passRate 1 when caseIds filter matches nothing", () => {
    const database = freshDb();
    const suite = runGsdLaneEvalSuite(database, {
      caseIds: [`missing-case-${Date.now()}`],
      persistReceipts: false,
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    });
    expect(suite.totalCases).toBe(0);
    expect(suite.passRate).toBe(1);
    expect(suite.failedCases).toBe(0);
  });
});
