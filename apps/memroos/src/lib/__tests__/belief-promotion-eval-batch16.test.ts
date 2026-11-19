// @vitest-environment node
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief-promotion-eval batch16 — handler failure branches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("contradicted_gold_demotes_in_one_cycle fails when superseding promote does not admit", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const promotion = await import("@/lib/belief/promotion");
    const original = promotion.promoteCandidate;
    let promoteCalls = 0;
    vi.spyOn(promotion, "promoteCandidate").mockImplementation((...args) => {
      promoteCalls += 1;
      if (promoteCalls >= 3) {
        return { kind: "denied", reason: "forced_test_denial", category: "operational" } as never;
      }
      return original(...args);
    });

    const casesPath = path.join(os.tmpdir(), `belief-b16-contra-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "contradicted_gold_demotes_in_one_cycle", description: "fail path", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toContain("superseding candidate to admit");
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("receipt_exposes_stage fails when receipts omit stage metadata", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const outbound = await import("@/lib/belief/outbound-policy");
    vi.spyOn(outbound, "filterOutboundClaims").mockImplementation(() => ({
      emitted: [],
      dropped: [],
      receipts: [{ claimHash: "sha256:abc", action: "emit", reason: "test" } as never],
    }));

    const casesPath = path.join(os.tmpdir(), `belief-b16-receipt-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "receipt_exposes_stage", description: "missing stage", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toContain("receipt missing stage");
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("high_stakes_blocked_until_review fails when review resolution is not approved", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const promotion = await import("@/lib/belief/promotion");
    vi.spyOn(promotion, "resolveReview").mockReturnValue({
      resolution: "rejected",
      admission: { kind: "denied", reason: "forced_reject" },
    } as never);

    const casesPath = path.join(os.tmpdir(), `belief-b16-hs-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "high_stakes_blocked_until_review", description: "reject path", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toContain("review resolution");
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("bronze_citation_only fails when citation mode omits citationOnly flag", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const outbound = await import("@/lib/belief/outbound-policy");
    vi.spyOn(outbound, "filterOutboundClaims").mockImplementation((_claims, policy, opts) => {
      if (opts?.citationMode) {
        return {
          emitted: [{ stage: "bronze_raw_source", content: "cited", action: "emit" } as never],
          dropped: [],
          receipts: [],
        };
      }
      return { emitted: [], dropped: [{ stage: "bronze_raw_source", reason: "dropped" } as never], receipts: [] };
    });

    const casesPath = path.join(os.tmpdir(), `belief-b16-bronze-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "bronze_citation_only", description: "missing flag", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toContain("citationOnly");
    fs.unlinkSync(casesPath);
    db.close();
  });
});
