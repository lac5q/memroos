// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { evaluateGsdLaneCase } from "../lane-evals";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("gsd lane-evals batch37", () => {
  it("evaluateGsdLaneCase records source_coverage mismatch failure (160)", () => {
    db = new Database(":memory:");
    initSchema(db);
    const result = evaluateGsdLaneCase(
      db,
      {
        id: "case-b37-source",
        lane: "planner",
        scenario: "source coverage batch37",
        rubric: { source_coverage: { weight: 1, minimum: 1 } },
        input: { sources: ["doc-a"] },
        expected: { sourceCoverage: 0.99, minimumScore: 0 },
      },
      false,
    );
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("source_coverage mismatch");
  });
});