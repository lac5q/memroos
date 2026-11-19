// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashScopeIdentity, normalizeScopeIdentity } from "@/lib/msiq/scope-identity";
import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "../runner";
import { validateFixtures, validateTask } from "../validation";
import { decideEntityMerge, extractEntities } from "../modules/entity-extraction";
import type { RetrievedItem } from "../schema";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

const PROVENANCE = {
  sourceCitation: "MemroOS internal synthetic benchmark",
  sourceLicense: "MIT",
  sourceAvailability: "synthetic" as const,
};

function minimalTask(overrides: Record<string, unknown> = {}) {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "c1", text: "corpus text" }],
    question: "q?",
    expected_answer: "a",
    license: "MIT",
    citation: "cite",
    provenance: PROVENANCE,
    ...overrides,
  };
}

describe("retrieval-bench batch14c — validation, entities, runner audit gates", () => {
  it("validateFixtures rejects non-object corpus entries and invalid provenance blocks", () => {
    const badCorpus = validateFixtures([
      {
        ...minimalTask({ id: "bad-corpus" }),
        corpus: ["not-an-object"],
      },
    ]);
    expect(badCorpus.ok).toBe(false);
    expect(badCorpus.issues.some((i) => i.reason === "corpus_entry_not_object")).toBe(true);

    const badProvenance = validateFixtures([
      {
        ...minimalTask({ id: "bad-prov" }),
        provenance: "string-not-object",
      },
    ]);
    expect(badProvenance.ok).toBe(false);
    expect(badProvenance.issues.some((i) => i.reason === "provenance_not_object")).toBe(true);

    const badAvailability = validateFixtures([
      {
        ...minimalTask({ id: "bad-avail" }),
        provenance: { ...PROVENANCE, sourceAvailability: "maybe" },
      },
    ]);
    expect(badAvailability.ok).toBe(false);
    expect(badAvailability.issues.some((i) => i.reason === "provenance_sourceAvailability_invalid")).toBe(true);
  });

  it("validateTask flags incomplete corpus scope and dangling evidence spans", () => {
    const ctx = { seenIds: new Set<string>() };
    const scopeBad = validateTask(
      minimalTask({
        id: "scope-incomplete",
        corpus: [
          {
            id: "c1",
            text: "t",
            scope: {
              tenantId: "t",
              userId: "u",
              agentId: "a",
              spaceId: "s",
              label: { visibility: "internal" },
            },
          },
        ],
      }),
      ctx,
    );
    expect(scopeBad.ok).toBe(false);
    if (scopeBad.ok) return;
    expect(scopeBad.issues.some((i) => i.reason === "candidate_scope_invalid")).toBe(true);

    const dangling = validateTask(
      minimalTask({
        id: "dangling-span",
        evidence_spans: ["missing-id"],
      }),
      ctx,
    );
    expect(dangling.ok).toBe(false);
    if (dangling.ok) return;
    expect(dangling.issues.some((i) => i.reason === "dangling_evidence_span")).toBe(true);
  });

  it("validateTask rejects malformed session turns and invalid temporal ISO fields", () => {
    const ctx = { seenIds: new Set<string>() };
    const turnBad = validateTask(
      minimalTask({
        id: "turn-bad",
        sessions: [{ session_id: "s1", turns: ["not-object"] }],
      }),
      ctx,
    );
    expect(turnBad.ok).toBe(false);
    if (turnBad.ok) return;
    expect(turnBad.issues.some((i) => i.reason === "turn_not_object")).toBe(true);

    const temporalBad = validateTask(
      minimalTask({
        id: "temporal-bad",
        temporal_metadata: { reference_time_iso: "not-a-date" },
      }),
      ctx,
    );
    expect(temporalBad.ok).toBe(false);
    if (temporalBad.ok) return;
    expect(temporalBad.issues.some((i) => i.reason === "timestamp_invalid_iso8601")).toBe(true);
  });

  it("extractEntities classifies person/org/acronym surfaces and rejects newline spans", () => {
    const person = extractEntities("Jane Smith reviewed the plan.", { version: "v1", seed: 0 });
    expect(person.entities.some((e) => e.kind === "person")).toBe(true);

    const org = extractEntities("Acme International Holdings Corporation shipped parts.", { version: "v1", seed: 0 });
    expect(org.entities.some((e) => e.kind === "organization" || e.kind === "person")).toBe(true);

    const acronym = extractEntities("NASA approved the API.", { version: "v1", seed: 0 });
    expect(acronym.entities.some((e) => e.kind === "acronym")).toBe(true);

    const newlineSurface = extractEntities("The\nBroken Name appears here.", { version: "v1", seed: 0 });
    expect(newlineSurface.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);

    const empty = extractEntities("", { version: "v1", seed: 0 });
    expect(empty.ok).toBe(true);
    expect(empty.entities.length).toBe(0);
  });

  it("decideEntityMerge skips candidates with empty ids", () => {
    const built = extractEntities("Acme Corp", { version: "v1", seed: 0 });
    expect(built.entities.length).toBeGreaterThan(0);
    const merge = decideEntityMerge({
      scope: "tenant-a",
      candidates: [{ ...built.entities[0]!, id: "" }],
    });
    expect(merge.keptEntities.length).toBe(0);
  });

  it("runBenchmark fails closed on unknown datasets and no-write audit persistence", async () => {
    const unknown = await runBenchmark({
      dataset: "memroos_nonexistent_lane",
      adapter: "lexical",
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      limit: 1,
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.reason).toMatch(/lane/);

    const noWrite = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(noWrite.ok).toBe(true);
    if (!noWrite.ok) return;
    expect(noWrite.auditPersistence?.anySkippedNoWrite).toBe(true);
    expect(noWrite.auditPersistence?.allRequiredPersisted).toBe(false);
  });

  it("live fanout pipeline records stale and unauthorized candidates in denied stages", async () => {
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
    };
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    if (!normalized) throw new Error("scope");
    const scopeHash = hashScopeIdentity(normalized);

    const staleItem: RetrievedItem = {
      id: "stale-fanout",
      score: 88,
      text: "stale",
      tier: "live",
      source: "fanout",
      authorizationResult: "stale",
      whyEntered: "test",
      scopeHash,
      rankPosition: 1,
    };
    const deniedItem: RetrievedItem = {
      id: "denied-fanout",
      score: 87,
      text: "denied",
      tier: "live",
      source: "fanout",
      authorizationResult: "denied",
      whyEntered: "test",
      scopeHash,
      rankPosition: 2,
    };

    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      fanoutItemsForTest: [staleItem, deniedItem],
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "denied" && s.ids.includes("denied-fanout"))).toBe(true);
    expect(
      stages.some(
        (s) =>
          (s.stage === "stale" || s.stage === "denied") &&
          s.ids.includes("stale-fanout"),
      ),
    ).toBe(true);
  });
});
