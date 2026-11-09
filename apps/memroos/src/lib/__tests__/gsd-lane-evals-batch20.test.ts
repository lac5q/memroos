// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { evaluateGsdLaneCase } from "@/lib/gsd/lane-evals";

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

describe("gsd-lane-evals batch20 — truthyProof and expectation mismatches", () => {
  it("evaluateGsdLaneCase fails missingProof ordering mismatches", () => {
    const database = freshDb();
    const result = evaluateGsdLaneCase(
      database,
      {
        id: "missing-proof-order-b20",
        lane: "execution",
        scenario: "proof ordering",
        rubric: { proof_compliance: { weight: 1, minimum: 1 } },
        input: { requiredProof: ["b", "a"], proof: { a: "ok" } },
        expected: { missingProof: ["a", "b"] },
      },
      false,
    );
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("missingProof"))).toBe(true);
  });

  it("evaluateGsdLaneCase checks recallProvenanceCount and resumability expectations", () => {
    const database = freshDb();
    const recallFail = evaluateGsdLaneCase(
      database,
      {
        id: "recall-count-b20",
        lane: "research",
        scenario: "recall count",
        rubric: { recall_provenance: { weight: 1, minimum: 1 } },
        input: { recallProvenance: ["a"] },
        expected: { recallProvenanceCount: 2, minimumScore: 0 },
      },
      false,
    );
    expect(recallFail.passed).toBe(false);

    const resumeFail = evaluateGsdLaneCase(
      database,
      {
        id: "resume-b20",
        lane: "execution",
        scenario: "handoff",
        rubric: { resumability: { weight: 1, minimum: 1 } },
        input: {},
        expected: { resumable: true, minimumScore: 0 },
      },
      false,
    );
    expect(resumeFail.failures.some((f) => f.includes("resumability"))).toBe(true);
  });

  it("evaluateGsdLaneCase validates groundedClaims and safetyGatePassed", () => {
    const database = freshDb();
    const grounded = evaluateGsdLaneCase(
      database,
      {
        id: "grounded-b20",
        lane: "research",
        scenario: "claims",
        rubric: { claim_grounding: { weight: 1, minimum: 1 } },
        input: { claims: [{ text: "x", source: "" }] },
        expected: { groundedClaims: 1, minimumScore: 0 },
      },
      false,
    );
    expect(grounded.passed).toBe(false);

    const safety = evaluateGsdLaneCase(
      database,
      {
        id: "safety-b20",
        lane: "execution",
        scenario: "gate",
        rubric: { safety_gate: { weight: 1, minimum: 1 } },
        input: { destructiveAction: "drop", requiredProof: ["approval"], proof: { approval: false } },
        expected: { safetyGatePassed: true, minimumScore: 0 },
      },
      false,
    );
    expect(safety.failures.some((f) => f.includes("safety_gate"))).toBe(true);
  });
});
