// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

describe("belief-promotion-eval batch23 — success paths for high-stakes and bronze", () => {
  let db: Database.Database;
  let casesPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    casesPath = path.join(os.tmpdir(), `belief-b23-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "high_stakes_blocked_until_review", description: "batch23", expectations: {} },
        { id: "bronze_citation_only", description: "batch23", expectations: {} },
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

  it("high_stakes_blocked_until_review passes when review queue and caveats behave", async () => {
    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const high = run.cases.find((c) => c.name === "high_stakes_blocked_until_review");
    expect(high?.pass).toBe(true);
  });

  it("bronze_citation_only passes under default outbound policy handlers", async () => {
    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const bronze = run.cases.find((c) => c.name === "bronze_citation_only");
    expect(bronze?.pass).toBe(true);
  });
});
