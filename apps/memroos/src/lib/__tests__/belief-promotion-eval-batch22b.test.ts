// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief-promotion-eval batch22b — bronze citation and high-stakes branches", () => {
  let db: Database.Database;
  let casesPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    casesPath = path.join(os.tmpdir(), `belief-b22b-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "high_stakes_blocked_until_review", description: "batch22b", expectations: {} },
        { id: "bronze_citation_only", description: "batch22b", expectations: {} },
      ]),
      "utf8",
    );
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(casesPath)) fs.unlinkSync(casesPath);
  });

  it("runs high_stakes and bronze_citation_only eval handlers", async () => {
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.cases.find((c) => c.name === "high_stakes_blocked_until_review")?.pass).toBe(true);
    expect(run.cases.find((c) => c.name === "bronze_citation_only")?.pass).toBe(true);
  });
});
