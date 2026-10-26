/**
 * End-to-end runner tests (VAL-RETR-001, VAL-RETR-005, VAL-RETR-008, VAL-RETR-013).
 */
//@vitest-environment node
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runBenchmark,
  writeReport,
  renderTextReport,
  loadDataset,
} from "../runner";
import { canonicalOutputPath } from "../redaction";
import { hashScopeIdentity, normalizeScopeIdentity } from "@/lib/msiq/scope-identity";
import { resolveFromRepoRoot } from "@/lib/paths";
import { createWriteGuard } from "../modules/cli-parser";
import { getAdapter } from "../adapters";
import type { StageRecord } from "../modules/reconciliation";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

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
  maxFreshnessSeconds: null,
};

describe("runBenchmark smoke (VAL-RETR-001)", () => {
  it("loads exactly 25 synthetic tasks with the lexical adapter", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 25,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.taskCount).toBe(25);
    expect(r.report.dataset).toBe("memroos_public_synthetic");
    expect(r.report.adapter).toBe("lexical");
    expect(r.report.aggregate.precisionAtK).toBeGreaterThan(0);
    expect(r.report.aggregate.recallAtK).toBeGreaterThan(0);
    expect(r.report.aggregate.mrr).toBeGreaterThan(0);
    expect(r.report.fixtureHash.startsWith("sha256:")).toBe(true);
    expect(r.report.configHash.startsWith("sha256:")).toBe(true);
  });

  it("produces reproducible config + fixture hashes across runs", async () => {
    const a = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 5,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    const b = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 5,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    if (!a.ok || !b.ok) throw new Error("runs failed");
    expect(a.report.configHash).toBe(b.report.configHash);
    expect(a.report.fixtureHash).toBe(b.report.fixtureHash);
  });

  it("marks no-memory adapter as having zero injection", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "no-memory",
      limit: 5,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.tasks.every((t) => t.injectedCount === 0)).toBe(true);
  });

  it("marks vector/mem0/qdrant adapters as unavailable (typed, never silent zero)", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "vector-local",
      limit: 5,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.tasks.every((t) => t.status === "unavailable")).toBe(true);
    expect(r.report.aggregate.failedTaskCount).toBe(5);
  });

  it("live adapter applies authorization scope (VAL-RETR-007)", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 5,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const t of r.report.tasks) {
      expect(t.receipt.authorization.evaluated).toBe(true);
    }
  });

  it("never reinjects foreign or missing-scope fanout candidates for live", async () => {
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    if (!normalized) throw new Error("expected complete live test scope");
    const foreignScopeHash = hashScopeIdentity({
      ...normalized,
      tenantId: "foreign-tenant",
    });
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      fanoutItemsForTest: [
        {
          id: "foreign-fanout",
          score: 99,
          text: "foreign candidate",
          tier: "live",
          source: "fanout",
          authorizationResult: "allowed",
          whyEntered: "test",
          scopeHash: foreignScopeHash,
          rankPosition: 1,
        },
        {
          id: "missing-scope-fanout",
          score: 98,
          text: "missing scope candidate",
          tier: "live",
          source: "fanout",
          authorizationResult: "allowed",
          whyEntered: "test",
          rankPosition: 2,
        },
        {
          id: "forged-matching-hash-fanout",
          score: 97,
          text: "forged matching hash candidate",
          tier: "live",
          source: "fanout",
          authorizationResult: "allowed",
          whyEntered: "test",
          scopeHash: hashScopeIdentity(normalized),
          rankPosition: 3,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const task = r.report.tasks[0];
    expect(task.receipt.authorization.scopeHash).toMatch(/^sha256:/);
    expect(task.injectedCount).toBeGreaterThan(0);
    expect(r.pipeline?.perTaskStageRecords.get(task.taskId)?.some(
      (record) =>
        record.stage === "denied" &&
        record.ids.includes("foreign-fanout") &&
        record.ids.includes("missing-scope-fanout") &&
        record.ids.includes("forged-matching-hash-fanout"),
    )).toBe(true);
  });

  it("reports an explicit error for unknown adapters", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "unicorn-adapter" as never,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("adapter_not_registered");
    }
  });

  it("rejects unsupported datasets with a typed reason", async () => {
    const r = await runBenchmark({
      dataset: "longmemeval_v2",
      adapter: "lexical",
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("longmemeval_v2_unavailable");
    }
  });

  it("reproduces reports across runs (VAL-RETR-013)", async () => {
    const a = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 10,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    const b = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 10,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    if (!a.ok || !b.ok) throw new Error("runs failed");
    expect(a.report.aggregate.precisionAtK).toBe(b.report.aggregate.precisionAtK);
    expect(a.report.aggregate.recallAtK).toBe(b.report.aggregate.recallAtK);
    expect(a.report.aggregate.mrr).toBe(b.report.aggregate.mrr);
    expect(a.report.tasks.map((t) => t.precisionAtK)).toEqual(
      b.report.tasks.map((t) => t.precisionAtK),
    );
  });

  it("partitions per-lane aggregates (VAL-RETR-008)", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 5,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.report.aggregate.laneMetrics)).toContain("external_retrieval");
    expect(r.report.aggregate.laneMetrics.external_retrieval?.taskCount).toBe(5);
  });
});

describe("writeReport + renderTextReport", () => {
  it("writes JSON output to the canonical path", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 3,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tmpDir = "/tmp/bench-output-" + Date.now();
    const w = writeReport({ report: r.report, outputDir: tmpDir });
    expect(w.path).toBe(
      canonicalOutputPath({ resultsDir: tmpDir, dataset: r.report.dataset, adapter: r.report.adapter, lane: r.report.lane }),
    );
    const fs = await import("node:fs");
    expect(fs.existsSync(w.path)).toBe(true);
  });

  it("renders a text report that includes aggregate metrics and lane data", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 3,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = renderTextReport(r.report);
    expect(text).toContain("precision@k");
    expect(text).toContain("recall@k");
    expect(text).toContain("Lane:");
  });
});

describe("runBenchmark governance gates", () => {
  it("requires CLI parser or cliCommand when bypassCliParser is false", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      bypassCliParser: false,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("cli_parser_required");
    }
  });

  it("accepts cliCommand as the governed entry point", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 3,
      k: 3,
      seed: 0,
      cliCommand: { noWrite: true },
      bypassCliParser: false,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.taskCount).toBe(3);
  });

  it("marks mem0 and qdrant adapters as unavailable", async () => {
    for (const adapter of ["mem0", "qdrant"] as const) {
      const r = await runBenchmark({
        dataset: "memroos_public_synthetic",
        adapter,
        limit: 3,
        k: 3,
        seed: 0,
        bypassCliParser: true,
        fixturesDir: FIXTURES_DIR,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.report.tasks.every((task) => task.status === "unavailable")).toBe(true);
    }
  });
});

describe("loadDataset explicit errors", () => {
  it("refuses locomo without caller-local source", () => {
    const r = loadDataset({ dataset: "locomo", fixturesDir: FIXTURES_DIR });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("locomo_source_not_provided");
    }
  });

  it("refuses longmemeval without caller-local source", () => {
    const r = loadDataset({ dataset: "longmemeval", fixturesDir: FIXTURES_DIR });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("longmemeval_source_not_provided");
    }
  });

  it("refuses longmemeval_v2 with an explicit unavailable reason", () => {
    const r = loadDataset({ dataset: "longmemeval_v2", fixturesDir: FIXTURES_DIR });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("longmemeval_v2_unavailable");
    }
  });

  it("refuses unsupported dataset ids", () => {
    const r = loadDataset({ dataset: "unknown_dataset" as "memroos_public_synthetic", fixturesDir: FIXTURES_DIR });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("dataset_unsupported");
    }
  });

  it("fails smoke run when synthetic fixture loading breaks", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 1,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: path.join(FIXTURES_DIR, "missing-dir"),
    });
    expect(r.ok).toBe(false);
  });
});

describe("runBenchmark extended seams", () => {
  it("records stale live pipeline candidates in stage records", async () => {
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    if (!normalized) throw new Error("expected complete live test scope");
    const scopeHashValue = hashScopeIdentity(normalized);
    const rerankMod = await import("../modules/rerank");
    const staleItem = {
      id: "stale-rerank",
      score: 99,
      text: "stale candidate",
      tier: "live" as const,
      source: "live",
      authorizationResult: "stale" as const,
      whyEntered: "test",
      scopeHash: scopeHashValue,
      rankPosition: 1,
    };
    vi.spyOn(rerankMod, "rerankCandidates").mockResolvedValueOnce({
      items: [staleItem],
      receipt: { strategy: "provider", cutoff: 3, inputCount: 1, outputCount: 1 },
    });
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
    });
    vi.restoreAllMocks();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const task = r.report.tasks[0];
    expect(
      r.pipeline?.perTaskStageRecords.get(task.taskId)?.some(
        (record) => record.stage === "stale" && record.ids.includes("stale-rerank")
      )
    ).toBe(true);
  });

  it("normalizes invalid adapter payloads to provider_failed results", async () => {
    const entry = getAdapter("lexical");
    if (!entry) throw new Error("lexical adapter missing");
    vi.spyOn(entry.adapter, "run").mockResolvedValueOnce({
      taskId: "broken",
      adapterName: "lexical",
      retrieved: "not-an-array",
      injected: [],
      ignored: [],
      latencyMs: 1,
      status: "ok",
      receipt: { metrics: {}, authorization: { evaluated: false } },
    } as never);
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    vi.restoreAllMocks();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.tasks[0]?.status).toBe("provider_failed");
  });

  it("writes markdown reports through renderTextReport", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 2,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tmpDir = `/tmp/bench-md-out-${Date.now()}`;
    const w = writeReport({ report: r.report, outputDir: tmpDir, extension: "md" });
    const fs = await import("node:fs");
    expect(fs.existsSync(w.path)).toBe(true);
    expect(fs.readFileSync(w.path, "utf8")).toContain("Aggregate Scores");
  });

  it("forwards per-task stage records through onStageRecords", async () => {
    const stageRecords = new Map<string, StageRecord[]>();
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 2,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      onStageRecords: (records) => {
        for (const [taskId, rows] of records.entries()) {
          stageRecords.set(taskId, rows);
        }
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stageRecords.size).toBeGreaterThan(0);
    const firstTaskStages = stageRecords.values().next().value as StageRecord[];
    expect(firstTaskStages.some((row) => row.stage === "injected")).toBe(true);
  });

  it("classifies thrown adapter errors as unavailable task results", async () => {
    const entry = getAdapter("lexical");
    if (!entry) throw new Error("lexical adapter missing");
    vi.spyOn(entry.adapter, "run").mockRejectedValueOnce(new Error("ETIMEDOUT calling provider"));

    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
    });
    vi.restoreAllMocks();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.tasks[0]?.status).toBe("provider_timeout");
  });

  it("honors armed write guards when writing markdown reports", async () => {
    const r = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 3,
      k: 3,
      seed: 0,
      rerankEnabled: true,
      judgeEnabled: true,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      withAudit: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const guard = createWriteGuard(true);
    const ensureWritable = vi.spyOn(guard, "ensureWritable");
    const tmpDir = `/tmp/bench-md-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    expect(() =>
      writeReport({
        report: r.report,
        outputDir: tmpDir,
        extension: "md",
        writeGuard: guard,
      }),
    ).toThrow(/no_write_blocked/);
    expect(ensureWritable).toHaveBeenCalledWith(expect.objectContaining({ reason: "report_write" }));

    const text = renderTextReport(r.report);
    expect(text).toContain("Per-Lane Aggregates");
    expect(text).toContain("precision@k");
  });
});
