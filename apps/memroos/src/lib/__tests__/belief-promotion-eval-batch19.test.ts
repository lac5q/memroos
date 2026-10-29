// @vitest-environment node
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { loadBeliefPromotionEvalCases, runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief-promotion-eval batch19 — loader validation and runner edges", () => {
  afterEach(() => {
    delete process.env.BELIEF_PROMOTION_EVAL_CASES_PATH;
  });

  it("loadBeliefPromotionEvalCases rejects non-array JSON", () => {
    const casesPath = path.join(os.tmpdir(), `belief-b19-bad-${Date.now()}.json`);
    fs.writeFileSync(casesPath, JSON.stringify({ not: "array" }), "utf8");
    expect(() => loadBeliefPromotionEvalCases(casesPath)).toThrow(/must be a JSON array/);
    fs.unlinkSync(casesPath);
  });

  it("runBeliefPromotionEvalSuite reports missing db for catalog cases", async () => {
    const run = await runBeliefPromotionEvalSuite({ mode: "gold" });
    expect(run.pass).toBe(false);
    expect(run.cases.some((r) => r.reason.includes("no db"))).toBe(true);
  });

  it("runBeliefPromotionEvalSuite marks unknown handlers as failures", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const casesPath = path.join(os.tmpdir(), `belief-b19-unknown-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "unknown_case_id_b19", description: "missing handler", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toMatch(/no handler registered/i);
    fs.unlinkSync(casesPath);
    db.close();
  });
});
