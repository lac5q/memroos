// @vitest-environment node
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief-promotion-eval batch15 — full handler paths", () => {
  it("runs contradicted_gold_demotes_in_one_cycle and high_stakes_blocked_until_review", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const casesPath = path.join(os.tmpdir(), `belief-b15-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "contradicted_gold_demotes_in_one_cycle", description: "demote cycle", expectations: {} },
        { id: "high_stakes_blocked_until_review", description: "review gate", expectations: {} },
        { id: "bronze_citation_only", description: "bronze cite", expectations: {} },
      ]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.cases.length).toBe(3);
    expect(run.pass).toBe(true);
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("receipt_exposes_stage validates claimHash shape on outbound receipts", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const casesPath = path.join(os.tmpdir(), `belief-b15-receipt-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "receipt_exposes_stage", description: "receipt", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.cases[0]?.pass).toBe(true);
    fs.unlinkSync(casesPath);
    db.close();
  });
});
