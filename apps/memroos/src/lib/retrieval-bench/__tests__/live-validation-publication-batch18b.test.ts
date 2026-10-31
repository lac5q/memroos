// @vitest-environment node
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy, liveAdapter } from "../adapters/live";
import { validateTask } from "../validation";
import { buildReplayHandle, evaluatePublicationGate, receiptLineageFor } from "../modules/report-publication";
import type { AggregateReport, AdapterReceipt } from "../schema";

const LIVE_SCOPE = {
  tenantId: "benchmark-tenant",
  userId: "benchmark-user",
  agentId: "benchmark-agent",
  spaceId: "benchmark-space",
  label: {
    visibility: "internal" as const,
    policy: "agent_visible" as const,
    domain: "benchmark",
    sensitivity: null,
  },
  purpose: "memory_search" as const,
  beliefStage: "silver_candidate_claim" as const,
  maxFreshnessSeconds: 60,
};

describe("retrieval-bench live/validation/publication batch18b", () => {
  it("evaluateLivePolicy marks stale candidates when maxFreshnessSeconds exceeded", () => {
    const decision = evaluateLivePolicy({
      task: {
        id: "t1",
        abstention_correct: false,
      } as never,
      scope: LIVE_SCOPE,
      candidate: {
        id: "c-old",
        timestamp_iso: "2020-01-01T00:00:00.000Z",
        scope: LIVE_SCOPE,
      },
    });
    expect(decision.kind).toBe("stale");
    expect(decision.reason).toBe("candidate_too_old");
  });

  it("validateTask rejects invalid temporal_direction enum", () => {
    const base = {
      id: "task-temporal-b18b",
      dataset: "memroos_public_synthetic",
      task_type: "temporal",
      corpus: [{ id: "mem-1", text: "Event happened on Tuesday." }],
      question: "When?",
      expected_answer: "Tuesday",
      evidence_spans: ["mem-1"],
      license: "MIT",
      citation: "MemroOS synthetic",
      provenance: {
        dataset: "memroos_public_synthetic",
        sourceCitation: "MemroOS synthetic",
        sourceLicense: "MIT",
        sourceAvailability: "synthetic",
      },
      temporal_metadata: { temporal_direction: "sideways" },
    };
    const result = validateTask(base, { seenIds: new Set() });
    expect(result.ok).toBe(false);
  });

  it("liveAdapter denies all corpus entries when scope is incomplete", async () => {
    const result = await liveAdapter.run({
      task: {
        id: "live-deny-b18b",
        question: "test",
        corpus: [{ id: "mem-1", text: "alpha beta" }],
      } as never,
      k: 3,
      configHash: "sha256:cfg",
      fixtureHash: "sha256:fix",
      scope: { tenantId: "t" },
    });
    expect(result.retrieved).toEqual([]);
    expect(result.ignored.length).toBeGreaterThan(0);
  });

  it("buildReplayHandle detects provider flag drift and receiptLineage captures pack hash", () => {
    const handle = buildReplayHandle({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      lane: "external_retrieval",
      configHash: "sha256:cfg",
      fixtureHash: "sha256:fix",
      seed: 1,
      k: 5,
      providerFlags: { qdrant: true },
      rerankEnabled: false,
      judgeEnabled: false,
    });
    expect(
      handle.matches({
        dataset: "memroos_public_synthetic",
        adapter: "lexical",
        lane: "external_retrieval",
        configHash: "sha256:cfg",
        fixtureHash: "sha256:fix",
        seed: 1,
        k: 5,
        providerFlags: { qdrant: false },
        rerankEnabled: false,
        judgeEnabled: false,
      }),
    ).toBe(false);

    const receipt: AdapterReceipt = {
      adapterName: "lexical",
      adapterVersion: "v1",
      status: "ok",
      latencyMs: 1,
      provenance: {
        provider: "local",
        providerVersion: "1",
        retrievalPolicyVersion: "policy-v1",
        configHash: "sha256:cfg",
        fixtureHash: "sha256:fix",
      },
      metrics: {
        tokensRetrieval: null,
        tokensRerank: null,
        tokensPack: null,
        tokensJudge: null,
        contextPackBytes: null,
        contextPackHash: "sha256:pack-b18b",
        dependencyTimingMs: {},
      },
    };
    const lineage = receiptLineageFor(receipt);
    expect(lineage.stages.some((s) => s.includes("pack:"))).toBe(true);

    const blocked = evaluatePublicationGate({
      report: {
        dataset: "memroos_public_synthetic",
        adapter: "lexical",
        lane: "external_retrieval",
        seed: 1,
        k: 5,
        configHash: "sha256:cfg",
        fixtureHash: "sha256:fix",
        aggregate: { failedTaskCount: 1 },
      } as AggregateReport,
      provenance: {
        configHash: "sha256:cfg",
        fixtureHash: "sha256:fix",
        seed: 1,
        k: 5,
        providerFlags: { qdrant: true },
      },
      receiptVerifications: [{ receiptHash: "sha256:r", chainDomain: "bench", verified: true, verifiedAtIso: new Date().toISOString() }],
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.caveats.some((c) => c.startsWith("failed_tasks_present"))).toBe(true);
  });
});
