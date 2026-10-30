// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief-promotion-eval batch22 — high-stakes and bronze citation branches", () => {
  let db: Database.Database;
  let casesPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    casesPath = path.join(os.tmpdir(), `belief-b22-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "high_stakes_blocked_until_review", description: "batch22", expectations: {} },
        { id: "bronze_citation_only", description: "batch22", expectations: {} },
      ]),
      "utf8",
    );
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(casesPath)) fs.unlinkSync(casesPath);
  });

  it("executes live high_stakes_blocked_until_review and bronze_citation_only handlers", async () => {
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const highStakes = run.cases.find((c) => c.name === "high_stakes_blocked_until_review");
    const bronze = run.cases.find((c) => c.name === "bronze_citation_only");
    expect(highStakes?.pass).toBe(true);
    expect(bronze?.pass).toBe(true);
  });
});
