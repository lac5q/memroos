// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `gsd-phase135-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "phase135.db");

async function loadDb() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  return import("@/lib/db");
}

describe("GSD lane evals + model routing policy", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadDb();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it("runs committed lane eval fixtures with ledger receipts", async () => {
    const { getDb } = await loadDb();
    const { runGsdLaneEvalSuite } = await import("@/lib/gsd/lane-evals");
    const result = runGsdLaneEvalSuite(getDb(), { persistReceipts: true });

    expect(result.totalCases).toBe(6);
    expect(result.passRate).toBe(1);
    expect(result.results.every((entry) => entry.ledgerReceiptId)).toBe(true);
  });

  it("routes cheap/local extraction by default and logs override receipts", async () => {
    const { getDb } = await loadDb();
    const { routeGsdModel, getGsdModelRoutingPolicy } = await import("@/lib/gsd/model-routing-policy");

    expect(getGsdModelRoutingPolicy().length).toBeGreaterThan(5);

    const cheap = routeGsdModel(getDb(), {
      taskClass: "classification",
      agentId: "agent-alpha",
      estimatedCostUsd: 0.01,
      qualityScore: 0.9,
    });
    expect(cheap.tier).toBe("cheap_local");

    const override = routeGsdModel(getDb(), {
      taskClass: "classification",
      agentId: "agent-alpha",
      overrideTier: "frontier",
      overrideReason: "hard customer escalation",
      qualityScore: 0.95,
    });
    expect(override.overrideApplied).toBe(true);
    expect(override.receiptId).toBeGreaterThan(0);
  });

  it("selects private and validator tiers from safety signals", async () => {
    const { getDb } = await loadDb();
    const { routeGsdModel } = await import("@/lib/gsd/model-routing-policy");

    const sensitive = routeGsdModel(getDb(), {
      taskClass: "formatting",
      agentId: "agent-alpha",
      sensitive: true,
    });
    expect(sensitive.tier).toBe("private_customer_bound");

    const validator = routeGsdModel(getDb(), {
      taskClass: "formatting",
      agentId: "agent-alpha",
      highRisk: true,
    });
    expect(validator.tier).toBe("validator");

    const vision = routeGsdModel(getDb(), {
      taskClass: "formatting",
      agentId: "agent-alpha",
      multimodal: true,
    });
    expect(vision.tier).toBe("vision");
  });
});
