// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildDefaultEvalConfig } from "@/lib/evals/config";
import type { AgentEvalTrace } from "@/lib/evals/types";

import { businessOpsL3Scorer, readEventsForCorrelation } from "../l3-scorer";

let testDb: Database.Database;

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

beforeEach(async () => {
  testDb = new Database(":memory:");
  initSchema(testDb);
  const dbMod = await import("@/lib/db");
  vi.mocked(dbMod.getDb).mockReturnValue(testDb);
});

afterEach(() => {
  testDb.close();
});

describe("l3-scorer batch33b", () => {
  it("readEventsForCorrelation returns [] when getDb throws (75)", async () => {
    const dbMod = await import("@/lib/db");
    vi.mocked(dbMod.getDb).mockImplementation(() => {
      throw new Error("DB unavailable batch33b");
    });
    expect(readEventsForCorrelation("corr-b33b")).toEqual([]);
    vi.mocked(dbMod.getDb).mockReturnValue(testDb);
  });

  it("businessOpsL3Scorer uses per-company l3_sub_weights (118)", () => {
    testDb
      .prepare(
        `INSERT INTO business_outcome_events
           (tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value, raw_json, polled_at)
         VALUES (?, ?, 'crm', 'hubspot', 'deal_advance', 'completion_rate', ?, '{}', datetime('now'))`,
      )
      .run("default-tenant", "trace-b33b-weights", 1);

    const trace: AgentEvalTrace = {
      traceId: "trace-b33b-weights",
      agentId: "agent-b33b",
      agentModelFamily: "openai",
      input: "x",
      output: "y",
      metadata: { company_id: "acme-b33b" },
    };
    const config = buildDefaultEvalConfig();
    config.companies = {
      "acme-b33b": {
        l3_sub_weights: {
          completion_rate: 1,
          escalation_rate: 0,
          ttr_p50: 0,
          approval_rate: 0,
          cost_per_task: 0,
        },
      },
    };
    const context = {
      config,
      judge: {
        score: 0.8,
        rubricScores: { faithful: 0.8, useful: 0.8, policy: 1 },
        model: "haiku",
        provider: "anthropic",
        modelFamily: "anthropic",
        promptTemplateVersion: "v1",
        promptHash: "abc",
        positionBiasMitigation: { swapAugmentation: false, orderAgreement: true },
      },
      goldenSet: [],
    };
    const result = businessOpsL3Scorer.score(trace, context);
    expect(result.metadata?.unavailable).toBeFalsy();
    expect(result.score).toBeCloseTo(1, 2);
  });
});
