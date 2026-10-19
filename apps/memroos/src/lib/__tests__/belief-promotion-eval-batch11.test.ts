// @vitest-environment node
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "../db-schema";
import * as promotion from "../belief/promotion";
import { loadBeliefPromotionEvalCases, runBeliefPromotionEvalSuite } from "../evals/belief-promotion-eval";

describe("belief promotion eval batch11", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("repoRoot fallback uses cwd when memory-recall cases are absent", () => {
    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      expect(() => loadBeliefPromotionEvalCases()).toThrow();
    } finally {
      process.chdir(prev);
    }
  });

  it("handler failure branch: unsupported silver unexpectedly admitted", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    vi.spyOn(promotion, "promoteCandidate").mockReturnValue({
      kind: "admitted",
      category: "operational",
      decisionId: "fake",
      receipt: {} as never,
    });
    const casesPath = path.join(os.tmpdir(), `belief-fail-admit-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "unsupported_silver_never_truth",
          description: "force admit failure path",
          expectations: {},
        },
      ]),
      "utf8"
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toMatch(/unexpectedly admitted/);
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("handler failure branch: contradicted gold promotion not admitted", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    vi.spyOn(promotion, "promoteCandidate").mockReturnValue({
      kind: "denied",
      failedCheck: "policy",
      reason: "forced deny",
      category: "operational",
      decisionId: "fake",
      receipt: {} as never,
    });
    const casesPath = path.join(os.tmpdir(), `belief-fail-contra-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "contradicted_gold_demotes_in_one_cycle",
          description: "force first promote deny",
          expectations: {},
        },
      ]),
      "utf8"
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toMatch(/expected promotion admitted/);
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("handler failure branch: bronze citation default drop mismatch", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const outbound = await import("../belief/outbound-policy");
    vi.spyOn(outbound, "filterOutboundClaims").mockReturnValue({
      emitted: [{ stage: "bronze_raw_source", content: "leak", caveat: null } as never],
      dropped: [],
      receipts: [],
    });
    const casesPath = path.join(os.tmpdir(), `belief-fail-bronze-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "bronze_citation_only",
          description: "force bronze emit under default",
          expectations: {},
        },
      ]),
      "utf8"
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toMatch(/bronze should be dropped/);
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("handler failure branch: high stakes not queued_for_review", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    vi.spyOn(promotion, "promoteCandidate").mockReturnValue({
      kind: "denied",
      failedCheck: "policy",
      reason: "forced deny",
      category: "pricing",
      decisionId: "fake",
      receipt: {} as never,
    });
    const casesPath = path.join(os.tmpdir(), `belief-fail-high-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "high_stakes_blocked_until_review",
          description: "force queue miss",
          expectations: {},
        },
      ]),
      "utf8"
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toMatch(/queued_for_review/);
    fs.unlinkSync(casesPath);
    db.close();
  });
});
