// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { routeGsdModel } from "@/lib/gsd/model-routing-policy";
import { runCrossModalEval } from "@/lib/skillforge/integration";
import type { SkillForgeProposal } from "@/lib/skillforge/types";
import {
  aggregateByLane,
  aggregateTaskScores,
  measured,
  round,
  unavailable,
} from "@/lib/retrieval-bench/metrics";
import { buildUnavailableResult, registerAdapter, resetAdapterRegistry } from "@/lib/retrieval-bench/adapters";
import { buildNoMemoryUnavailable } from "@/lib/retrieval-bench/adapters/no-memory";
import { isStageRecord, stageRecord } from "@/lib/retrieval-bench/modules/reconciliation";
import { buildOntologyTypeReceiptRef, ontologyTypeFromCanonicalId } from "@/lib/ontology/receipt-types";

describe("long-tail batch 1 — lib modules", () => {
  it("metrics round and availability helpers enforce finite values", () => {
    expect(round(Number.NaN)).toBeNaN();
    expect(measured(3)).toEqual({ status: "measured", value: 3, reason: null });
    expect(() => measured(Number.NaN)).toThrow(/finite/);
    expect(() => unavailable("  ")).toThrow(/reason/);
    expect(aggregateTaskScores([]).completedTaskCount).toBe(0);
    expect(aggregateByLane([])).toEqual({});
  });

  it("retrieval adapter registry builds unavailable results", () => {
    resetAdapterRegistry();
    const fake = { id: "t1", corpus: [{ id: "c1", text: "x" }] } as never;
    const result = buildUnavailableResult({
      task: fake,
      adapterName: "lexical",
      status: "unavailable",
      statusDetail: "missing",
      retrievalPolicyVersion: "v1",
      configHash: "cfg",
      fixtureHash: "fix",
      latencyMs: 0,
    });
    expect(result.status).toBe("unavailable");
    expect(result.ignored[0]?.whyMissed).toBe("adapter_unavailable");

    registerAdapter("lexical", {
      adapter: { id: "lexical", version: "0", isBaselineControl: true, run: async () => result },
      provider: null,
      providerVersion: null,
    });
    expect(buildNoMemoryUnavailable(fake, "v1", "cfg", "fix").adapterName).toBe("no-memory");
    resetAdapterRegistry();
  });

  it("reconciliation stageRecord and guard accept valid shapes", () => {
    const record = stageRecord({ taskId: "t1", stage: "injected", ids: ["a"] });
    expect(isStageRecord(record)).toBe(true);
    expect(isStageRecord({ taskId: 1, stage: "injected" })).toBe(false);
  });

  it("ontology receipt refs reject empty ontology types", () => {
    expect(() => buildOntologyTypeReceiptRef({ ontologyType: "  " })).toThrow(/ontologyType/i);
    expect(ontologyTypeFromCanonicalId("")).toBe("");
  });

  it("gsd model routing falls back to hard_reasoning for unknown task classes", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const routed = routeGsdModel(db, { taskClass: "novel_task_class_xyz" });
    expect(routed.tier).toBe("frontier");
    expect(routed.receiptId).toBeGreaterThan(0);
    db.close();
  });

  it("rate limiter tolerates many tenant buckets without throwing", async () => {
    const { checkRateLimit } = await import("@/lib/public-api/rate-limiter");
    const config = { requestsPerMinute: 60_000, burst: 1 };
    for (let i = 0; i < 1001; i += 1) {
      checkRateLimit(`batch1-lru-${i}`, config);
    }
    const result = checkRateLimit(`batch1-lru-fresh-${Date.now()}`, config);
    expect(result.allowed).toBe(true);
  });

  it("skillforge cross-modal eval returns stub judge dimensions", () => {
    const proposal = { id: "p1" } as SkillForgeProposal;
    const results = runCrossModalEval(proposal);
    expect(results.length).toBe(2);
    expect(results[0]?.overallScore).toBeGreaterThan(0);
  });
});
