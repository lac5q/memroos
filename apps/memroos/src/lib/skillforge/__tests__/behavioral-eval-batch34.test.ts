// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { runBehavioralABTest, type BehavioralTestCase } from "../behavioral-eval";

describe("behavioral-eval batch34 — zero-token scores and empty sample branches", () => {
  it("scoreVariant returns 0 when token list is empty (43)", () => {
    const db = new Database(":memory:");
    const cases: BehavioralTestCase[] = [
      {
        id: `zero-b34-${randomUUID().slice(0, 6)}`,
        skillId: "skill",
        input: "a b c",
        expectedOutput: "x y z",
        category: "edge",
        difficulty: "easy",
      },
    ];
    const result = runBehavioralABTest(db, "control", "treatment", cases);
    expect(result.controlW).toBe(0);
    expect(result.treatmentW).toBe(0);
    db.close();
  });

  it("runBehavioralABTest handles empty arrays and single-item variance (64–77, 81)", () => {
    const db = new Database(":memory:");
    const empty = runBehavioralABTest(db, "c", "t", []);
    expect(empty.sampleSize).toBe(0);
    expect(empty.significant).toBe(false);

    const single: BehavioralTestCase[] = [
      {
        id: `one-b34-${randomUUID().slice(0, 6)}`,
        skillId: "skill",
        input: "batch34 longer input token",
        expectedOutput: "batch34 longer expected output token",
        category: "single",
        difficulty: "hard",
      },
    ];
    const one = runBehavioralABTest(db, "control", "treatment", single);
    expect(one.sampleSize).toBe(1);
    expect(one.pValue).toBeGreaterThanOrEqual(0.001);
    db.close();
  });
});
