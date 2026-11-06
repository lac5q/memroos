// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBenchmark, renderTextReport } from "../runner";
import { validateFixtures, validateTask } from "../validation";
import { dedupeRetrievalResults, decideMerge } from "../modules/dedupe";
import { extractEntities, decideEntityMerge } from "../modules/entity-extraction";
import { resolveFromRepoRoot } from "@/lib/paths";
import type { AggregateReport, RetrievedItem } from "../schema";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

function baseItem(partial: Partial<RetrievedItem>): RetrievedItem {
  return {
    id: "mem-1",
    text: "hello",
    tier: "lexical",
    source: "fixture",
    score: 1,
    rankPosition: 1,
    scopeHash: "sha256:scope",
    authorizationResult: "allowed",
    ...partial,
  } as RetrievedItem;
}

describe("retrieval-bench batch14b — validation, modules, runner render", () => {
  it("validateFixtures flags invalid sessions, turns, temporal metadata, and corpus scope", () => {
    const bad = [
      {
        id: "t-scope-bad",
        dataset: "memroos_public_synthetic",
        task_type: "single_hop",
        corpus: [
          {
            id: "c1",
            text: "text",
            scope: { tenantId: "t", userId: "u", agentId: "a", spaceId: "s", label: { visibility: "internal" } },
          },
        ],
        sessions: [{ session_id: "s1", turns: [{ role: "bot", content: "x" }] }],
        question: "q",
        expected_answer: "a",
        evidence_spans: ["c1"],
        temporal_metadata: { temporal_direction: "sideways" },
        license: "MIT",
        citation: "cite",
        provenance: {
          sourceCitation: "MemroOS internal synthetic benchmark",
          sourceLicense: "MIT",
          sourceAvailability: "synthetic",
        },
      },
    ];
    const result = validateFixtures(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason === "candidate_scope_invalid")).toBe(true);
    expect(result.issues.some((i) => i.reason === "turn_role_invalid")).toBe(true);
    expect(result.issues.some((i) => i.reason === "temporal_direction_invalid_enum")).toBe(true);
  });

  it("validateTask rejects duplicate ids", () => {
    const ctx = { seenIds: new Set<string>() };
    validateTask(
      {
        id: "dup",
        dataset: "memroos_public_synthetic",
        task_type: "single_hop",
        corpus: [{ id: "c1", text: "t" }],
        question: "q",
        expected_answer: "a",
        license: "MIT",
        citation: "c",
        provenance: {
          sourceCitation: "MemroOS internal synthetic benchmark",
          sourceLicense: "MIT",
          sourceAvailability: "synthetic",
        },
      },
      ctx,
    );
    const dup = validateTask(
      {
        id: "dup",
        dataset: "memroos_public_synthetic",
        task_type: "single_hop",
        corpus: [{ id: "c2", text: "t" }],
        question: "q",
        expected_answer: "a",
        license: "MIT",
        citation: "c",
        provenance: {
          sourceCitation: "MemroOS internal synthetic benchmark",
          sourceLicense: "MIT",
          sourceAvailability: "synthetic",
        },
      },
      ctx,
    );
    expect(dup.ok).toBe(false);
  });

  it("dedupeRetrievalResults handles tier mismatch and derivative merge bookkeeping", () => {
    const a = baseItem({ id: "mem-1", tier: "lexical", score: 0.5 });
    const b = baseItem({ id: "mem-1-vector", tier: "vector-local", score: 0.9 });
    const decision = decideMerge({ existing: a, candidate: b });
    expect(decision.merge).toBe(false);

    const dupA = baseItem({ id: "mem-dup", score: 0.4 });
    const dupB = baseItem({ id: "mem-dup", score: 0.9 });
    const merged = dedupeRetrievalResults({ items: [dupA, dupB] });
    expect(merged.items.length).toBe(1);
    expect(merged.merged.length).toBeGreaterThan(0);
  });

  it("extractEntities classifies dates and decideEntityMerge skips empty ids", () => {
    const dates = extractEntities("Ship by 2026-08-09 and 08/10/2026.", { version: "v1", seed: 0 });
    expect(dates.entities.some((e) => e.kind === "date")).toBe(true);

    const longSurface = extractEntities("Acme International Holdings Corporation", {
      version: "v1",
      seed: 0,
      limits: { minEntitySurfaceLength: 50 },
    });
    expect(longSurface.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);

    const built = extractEntities("Acme Corp", { version: "v1", seed: 0 });
    const withEmpty = [{ ...built.entities[0]!, id: "" }];
    const merge = decideEntityMerge({ scope: "tenant-a", candidates: withEmpty });
    expect(merge.keptEntities.length).toBe(0);
  });

  it("runBenchmark smoke and renderTextReport skips null lane aggregates", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 2,
      k: 2,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.report.taskCount).toBe(2);

    const report = {
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      taskCount: 1,
      fixtureHash: "sha256:fixture",
      configHash: "sha256:config",
      aggregate: {
        taskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        precisionAtK: 1,
        recallAtK: 1,
        mrr: 1,
        falsePositiveRate: 0,
        answerSupportedRate: 1,
        p95LatencyMs: 1,
        abstentionAccuracy: null,
        abstentionLabeledCount: null,
        abstentionAnswerableFailureCount: null,
        contextPackBytes: null,
        contextPackHash: null,
        tokensRetrieval: null,
        tokensRerank: null,
        tokensPack: null,
        tokensJudge: null,
        laneMetrics: { gold: null },
      },
      tasks: [],
    } as unknown as AggregateReport;
    const text = renderTextReport(report);
    expect(text).toContain("Per-Lane Aggregates");
    expect(text).not.toContain("### gold");
  });
});
