// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief-promotion-eval batch20 — high-stakes and bronze handlers", () => {
  let db: Database.Database;
  let casesPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    casesPath = path.join(os.tmpdir(), `belief-b20-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "high_stakes_blocked_until_review", description: "batch20", expectations: {} },
        { id: "bronze_citation_only", description: "batch20", expectations: {} },
      ]),
      "utf8",
    );
  });

  afterEach(() => {
    db.close();
    fs.unlinkSync(casesPath);
  });

  it("runs high_stakes_blocked_until_review and bronze_citation_only handlers", async () => {
    const run = await runBeliefPromotionEvalSuite({
      mode: "full",
      db,
      casesPath,
    });
    const highStakes = run.cases.find((c) => c.name === "high_stakes_blocked_until_review");
    const bronze = run.cases.find((c) => c.name === "bronze_citation_only");
    expect(highStakes?.pass).toBe(true);
    expect(bronze?.pass).toBe(true);
  });
});
