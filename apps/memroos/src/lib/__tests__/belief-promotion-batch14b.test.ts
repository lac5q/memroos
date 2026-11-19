// @vitest-environment node
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief promotion eval batch14b — additional handler paths", () => {
  afterEach(() => {
    /* each case uses its own db */
  });

  it("runs high_stakes_blocked_until_review and bronze_citation_only together", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const casesPath = path.join(os.tmpdir(), `belief-b14b-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "high_stakes_blocked_until_review", description: "review queue", expectations: {} },
        { id: "bronze_citation_only", description: "bronze modes", expectations: {} },
      ]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(true);
    expect(run.cases.length).toBe(2);
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("receipt_exposes_stage fails when claimHash is malformed", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const outbound = await import("@/lib/belief/outbound-policy");
    const original = outbound.filterOutboundClaims;
    vi.spyOn(outbound, "filterOutboundClaims").mockImplementation((claims, policy, opts) => {
      const result = original(claims, policy, opts);
      return {
        ...result,
        receipts: result.receipts.map((r) => ({ ...r, claimHash: "bad" })),
      };
    });
    const casesPath = path.join(os.tmpdir(), `belief-b14b-receipt-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "receipt_exposes_stage", description: "bad receipt", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    fs.unlinkSync(casesPath);
    db.close();
  });
});
