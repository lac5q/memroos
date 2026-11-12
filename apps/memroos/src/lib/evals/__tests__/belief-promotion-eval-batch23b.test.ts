// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

describe("belief-promotion-eval batch23b — default suite cases", () => {
  let db: Database.Database;
  let casesPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    casesPath = path.join(os.tmpdir(), `belief-b23b-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "receipt_exposes_stage", description: "batch23b", expectations: {} },
        { id: "high_stakes_blocked_until_review", description: "batch23b", expectations: {} },
        { id: "bronze_citation_only", description: "batch23b", expectations: {} },
      ]),
      "utf8",
    );
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(casesPath)) fs.unlinkSync(casesPath);
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("receipt_exposes_stage passes with sha256 receipts", async () => {
    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const receiptCase = run.cases.find((c) => c.name === "receipt_exposes_stage");
    expect(receiptCase?.pass).toBe(true);
  });

  it("high_stakes_blocked_until_review exercises review queue and caveat receipts", async () => {
    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const high = run.cases.find((c) => c.name === "high_stakes_blocked_until_review");
    expect(high?.pass).toBe(true);
  });

  it("bronze_citation_only validates default drop vs citation-only emit", async () => {
    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const bronze = run.cases.find((c) => c.name === "bronze_citation_only");
    expect(bronze?.pass).toBe(true);
  });
});
