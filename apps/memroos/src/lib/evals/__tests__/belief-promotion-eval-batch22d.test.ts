// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

describe("belief-promotion-eval batch22d — handler failure branches", () => {
  let db: Database.Database;
  let casesPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    casesPath = path.join(os.tmpdir(), `belief-b22d-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "high_stakes_blocked_until_review", description: "batch22d", expectations: {} },
        { id: "bronze_citation_only", description: "batch22d", expectations: {} },
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

  it("high_stakes handler fails closed when silver caveat is missing before review", async () => {
    const outbound = await import("@/lib/belief/outbound-policy");
    const original = outbound.filterOutboundClaims;
    vi.spyOn(outbound, "filterOutboundClaims").mockImplementation((claims, policy, opts) => {
      if (opts?.citationMode) {
        return original(claims, policy, opts);
      }
      return {
        emitted: claims.map((claim) => ({ ...claim, stage: "gold_operational_truth" as const })),
        dropped: [],
        receipts: [],
      };
    });
    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const high = run.cases.find((c) => c.name === "high_stakes_blocked_until_review");
    expect(high?.pass).toBe(false);
    expect(high?.reason).toMatch(/caveat|silver|high-stakes/i);
  });

  it("bronze_citation_only handler fails when citation mode does not emit bronze", async () => {
    const outbound = await import("@/lib/belief/outbound-policy");
    const original = outbound.filterOutboundClaims;
    vi.spyOn(outbound, "filterOutboundClaims").mockImplementation((claims, policy, opts) => {
      if (opts?.citationMode) {
        return { emitted: [], dropped: claims, receipts: [] };
      }
      return original(claims, policy, opts);
    });
    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const bronze = run.cases.find((c) => c.name === "bronze_citation_only");
    expect(bronze?.pass).toBe(false);
    expect(bronze?.reason).toMatch(/bronze|citation/i);
  });
});
