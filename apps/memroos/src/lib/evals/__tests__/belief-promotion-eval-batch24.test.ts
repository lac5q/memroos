// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

describe("belief-promotion-eval batch24 — failure branches in invariant handlers", () => {
  let db: Database.Database;
  let casesPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    casesPath = path.join(os.tmpdir(), `belief-b24-${crypto.randomUUID()}.json`);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(casesPath)) fs.unlinkSync(casesPath);
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("@/lib/belief/outbound-policy");
  });

  it("high_stakes_blocked_until_review failure path when candidate stage drifts after queue", async () => {
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "high_stakes_blocked_until_review", description: "batch24", expectations: {} }]),
      "utf8",
    );
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("SELECT belief_stage FROM agent_memory_candidates")) {
        return { get: () => ({ belief_stage: "gold_operational_truth" }) } as ReturnType<typeof db.prepare>;
      }
      return originalPrepare(sql);
    }) as typeof db.prepare);

    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const high = run.cases.find((c) => c.name === "high_stakes_blocked_until_review");
    expect(high?.pass).toBe(false);
    expect(high?.reason).toMatch(/candidate stage expected silver/i);
  });

  it("high_stakes_blocked_until_review failure path when silver caveat is missing", async () => {
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "high_stakes_blocked_until_review", description: "batch24", expectations: {} }]),
      "utf8",
    );
    vi.doMock("@/lib/belief/outbound-policy", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/belief/outbound-policy")>();
      const original = actual.filterOutboundClaims;
      return {
        ...actual,
        filterOutboundClaims: (
          claims: Parameters<typeof original>[0],
          policy: Parameters<typeof original>[1],
          opts?: Parameters<typeof original>[2],
        ) => {
          if (opts?.citationMode) return original(claims, policy, opts);
          if (claims.length === 1 && claims[0]?.stage === "silver_candidate_claim") {
            return {
              emitted: [{ stage: "silver_candidate_claim", content: claims[0]!.content }],
              dropped: [],
              receipts: [],
            };
          }
          return original(claims, policy, opts);
        },
      };
    });
    vi.resetModules();

    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const high = run.cases.find((c) => c.name === "high_stakes_blocked_until_review");
    expect(high?.pass).toBe(false);
    expect(high?.reason).toMatch(/without caveat/i);
  });

  it("bronze_citation_only failure path when default policy drop count is wrong", async () => {
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "bronze_citation_only", description: "batch24", expectations: {} }]),
      "utf8",
    );
    vi.doMock("@/lib/belief/outbound-policy", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/belief/outbound-policy")>();
      const original = actual.filterOutboundClaims;
      return {
        ...actual,
        filterOutboundClaims: (
          claims: Parameters<typeof original>[0],
          policy: Parameters<typeof original>[1],
          opts?: Parameters<typeof original>[2],
        ) => {
          if (!opts?.citationMode && claims.every((c) => c.stage === "bronze_raw_source")) {
            return { emitted: [], dropped: [], receipts: [] };
          }
          return original(claims, policy, opts);
        },
      };
    });
    vi.resetModules();

    const { runBeliefPromotionEvalSuite } = await import("@/lib/evals/belief-promotion-eval");
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    const bronze = run.cases.find((c) => c.name === "bronze_citation_only");
    expect(bronze?.pass).toBe(false);
    expect(bronze?.reason).toMatch(/default dropped should have one bronze entry/i);
  });
});
