// @vitest-environment node
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { loadBeliefPromotionEvalCases, runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief-promotion-eval batch18b", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loadBeliefPromotionEvalCases returns stable catalog entries", () => {
    const cases = loadBeliefPromotionEvalCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((c) => c.id && c.expectations)).toBe(true);
  });

  it("unsupported_silver_never_truth fails when silver is promoted to gold", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const promotion = await import("@/lib/belief/promotion");
    vi.spyOn(promotion, "promoteCandidate").mockReturnValue({
      kind: "admitted",
      stage: "gold_operational_truth",
      category: "operational",
    } as never);

    const casesPath = path.join(os.tmpdir(), `belief-b18b-silver-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "unsupported_silver_never_truth", description: "silver leak", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    fs.unlinkSync(casesPath);
    db.close();
  });
});
