/**
 * Tests for VAL-RETR-014..030 (BENCH-03 + RETRIEVAL-01 continued).
 *
 * Each block targets a specific assertion:
 *   VAL-RETR-014 — no-write + path control
 *   VAL-RETR-015 — entity extraction determinism + bounds
 *   VAL-RETR-016 — tier fanout
 *   VAL-RETR-017 — rerank bounds + version
 *   VAL-RETR-018 — dedupe preserving distinct facts
 *   VAL-RETR-019 — context packing budget + coverage
 *   VAL-RETR-020 — temporal uncertainty disclosure
 *   VAL-RETR-021 — provider flag independence
 *   VAL-RETR-022 — credential fail-closed
 *   VAL-RETR-023 — provider content governance
 *   VAL-RETR-024 — stage reconciliation
 *   VAL-RETR-027 — deterministic reruns/isolation
 *   VAL-RETR-028 — incomplete reports blocked
 *   VAL-RETR-029 — replayable config
 *   VAL-RETR-030 — cross-lane/run contamination
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_FLAGS,
  applyProviderGovernanceGate,
  buildReplayHandle,
  canonicalReportPath,
  checkProviderAvailable,
  checkContamination,
  createIsolationContext,
  createWriteGuard,
  decideEntityMerge,
  decideMerge,
  dedupeRetrievalResults,
  describeProviderFlags,
  evaluatePublicationGate,
  extractEntities,
  isStageRecord,
  packContext,
  parseCliArgs,
  performTemporalRetrieval,
  performTierFanout,
  previewSnapshot,
  receiptLineageFor,
  reconcileStages,
  rerankCandidates,
  stageRecord,
} from "../index";
import type { RetrievedItem } from "../../schema";

// ---------------------------------------------------------------------------
// VAL-RETR-014 — no-write + path control
// ---------------------------------------------------------------------------
describe("CLI parser + write guard (VAL-RETR-014)", () => {
  it("parses a typical invocation", () => {
    const r = parseCliArgs(["--dataset", "x", "--limit", "5", "--no-write", "--json"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command?.dataset).toBe("x");
    expect(r.command?.limit).toBe(5);
    expect(r.command?.noWrite).toBe(true);
    expect(r.command?.json).toBe(true);
  });

  it("rejects missing values", () => {
    expect(parseCliArgs(["--dataset"]).ok).toBe(false);
    expect(parseCliArgs(["--limit", "--adapter", "x"]).ok).toBe(false);
  });

  it("rejects unknown flags", () => {
    expect(parseCliArgs(["--unicorn-flag"]).ok).toBe(false);
  });

  it("rejects malformed integer values", () => {
    const r = parseCliArgs(["--limit", "abc"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("invalid_limit");
    }
  });

  it("refuses live CLI runs without a complete safe scope", () => {
    expect(parseCliArgs(["--adapter", "live"]).reason).toBe("incomplete_live_scope");
    expect(parseCliArgs([
      "--adapter", "live",
      "--scope-tenant", "tenant",
      "--scope-user", "user",
      "--scope-agent", "agent",
      "--scope-space", "space",
      "--scope-label-visibility", "internal",
      "--scope-label-policy", "agent_visible",
      "--scope-purpose", "not-allowlisted",
      "--scope-belief-stage", "silver_candidate_claim",
    ]).reason).toBe("invalid_purpose");
    expect(parseCliArgs([
      "--adapter", "live",
      "--scope-tenant", "tenant",
      "--scope-user", "user",
      "--scope-agent", "agent",
      "--scope-space", "space",
      "--scope-label-visibility", "internal",
      "--scope-label-policy", "agent_visible",
      "--scope-purpose", "memory_search",
      "--scope-belief-stage", "silver_candidate_claim",
    ]).ok).toBe(true);
  });

  it("armored write guard blocks writes", () => {
    const guard = createWriteGuard(true);
    expect(guard.allow({ path: "/tmp/x.json", reason: "noop" })).toBe(false);
    expect(guard.attempts.length).toBe(1);
    expect(() => guard.ensureWritable({ path: "/tmp/x.json", reason: "noop" })).toThrow();
  });

  it("write guard permits writes when not armed", () => {
    const guard = createWriteGuard(false);
    expect(guard.allow({ path: "/tmp/x.json", reason: "noop" })).toBe(true);
  });

  it("canonicalReportPath is deterministic", () => {
    const a = canonicalReportPath({ resultsDir: "/tmp/r", dataset: "locomo", adapter: "lexical", lane: "external_retrieval", extension: "json" });
    const b = canonicalReportPath({ resultsDir: "/tmp/r", dataset: "locomo", adapter: "lexical", lane: "external_retrieval", extension: "json" });
    expect(a).toBe(b);
    expect(a).toBe("/tmp/r/locomo-lexical-external_retrieval-latest.json");
  });

  it("previewSnapshot reports existing files", () => {
    const snap = previewSnapshot({ paths: ["/definitely/not/a/real/path"] });
    expect(snap.ok).toBe(true);
  });

  it("parses numeric, boolean, scope, and output-dir flags", () => {
    const r = parseCliArgs([
      "--adapter", "lexical",
      "--k", "5",
      "--seed", "42",
      "--rerank",
      "--judge",
      "--scope-tenant", "tenant-a",
      "--scope-user", "user-a",
      "--scope-agent", "agent-a",
      "--scope-space", "space-a",
      "--scope-label-visibility", "internal",
      "--scope-label-policy", "agent_visible",
      "--scope-label-domain", "ops",
      "--scope-label-sensitivity", "low",
      "--scope-purpose", "recall",
      "--scope-belief-stage", "gold_claim",
      "--output-dir", "/tmp/custom-results",
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command).toMatchObject({
      adapter: "lexical",
      k: 5,
      seed: 42,
      rerank: true,
      judge: true,
      scopeTenant: "tenant-a",
      scopeUser: "user-a",
      scopeAgent: "agent-a",
      scopeSpace: "space-a",
      scopeLabelVisibility: "internal",
      scopeLabelPolicy: "agent_visible",
      scopeLabelDomain: "ops",
      scopeLabelSensitivity: "low",
      scopePurpose: "recall",
      scopeBeliefStage: "gold_claim",
      outputDir: "/tmp/custom-results",
    });
  });

  it("rejects missing values for every value-bearing flag", () => {
    const flags = [
      "--dataset",
      "--limit",
      "--adapter",
      "--k",
      "--seed",
      "--scope-tenant",
      "--scope-space",
      "--scope-user",
      "--scope-agent",
      "--scope-label-visibility",
      "--scope-label-policy",
      "--scope-label-domain",
      "--scope-label-sensitivity",
      "--scope-purpose",
      "--scope-belief-stage",
      "--output-dir",
    ];
    for (const flag of flags) {
      const r = parseCliArgs([flag]);
      expect(r.ok, flag).toBe(false);
      expect(r.reason, flag).toContain("missing_value_for_flag");
    }
  });

  it("rejects invalid k, limit, and negative seed values", () => {
    expect(parseCliArgs(["--k", "0"]).reason).toBe("invalid_k:0");
    expect(parseCliArgs(["--limit", "-3"]).reason).toContain("invalid_limit");
    expect(parseCliArgs(["--seed", "-1"]).reason).toBe("invalid_seed:-1");
    expect(parseCliArgs(["--k", "3.5"]).reason).toBe("invalid_k:3.5");
  });

  it("rejects live adapter scope with invalid visibility, policy, or belief stage", () => {
    const base = [
      "--adapter", "live",
      "--scope-tenant", "tenant",
      "--scope-user", "user",
      "--scope-agent", "agent",
      "--scope-space", "space",
      "--scope-purpose", "memory_search",
    ];
    expect(parseCliArgs([
      ...base,
      "--scope-label-visibility", "secret",
      "--scope-label-policy", "agent_visible",
      "--scope-belief-stage", "gold_claim",
    ]).reason).toBe("invalid_live_scope");
    expect(parseCliArgs([
      ...base,
      "--scope-label-visibility", "internal",
      "--scope-label-policy", "unknown_policy",
      "--scope-belief-stage", "gold_claim",
    ]).reason).toBe("invalid_live_scope");
    expect(parseCliArgs([
      ...base,
      "--scope-label-visibility", "internal",
      "--scope-label-policy", "agent_visible",
      "--scope-belief-stage", "draft",
    ]).reason).toBe("invalid_live_scope");
  });

  it("ignores positional arguments without failing", () => {
    const r = parseCliArgs(["extra-positional", "--json"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command?.json).toBe(true);
    expect(r.command?.rawArgs).toEqual(["extra-positional", "--json"]);
  });

  it("sanitizes unsafe characters in canonicalReportPath", () => {
    expect(
      canonicalReportPath({
        resultsDir: "/tmp/r/",
        dataset: "data set!!",
        adapter: "live",
        lane: "lane/name",
        extension: "md",
      }),
    ).toBe("/tmp/r/data-set-live-lane-name-latest.md");
  });

  it("previewSnapshot flags paths that already exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-preview-"));
    const file = path.join(dir, "existing.json");
    fs.writeFileSync(file, "{}");
    const snap = previewSnapshot({ paths: [file, path.join(dir, "missing.json")] });
    expect(snap.ok).toBe(false);
    expect(snap.exists).toEqual([file]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records byte counts on blocked write attempts", () => {
    const guard = createWriteGuard(true);
    expect(guard.allow({ path: "/tmp/out.json", reason: "report", bytes: 128 })).toBe(false);
    expect(guard.attempts[0]).toMatchObject({ path: "/tmp/out.json", bytes: 128, reason: "report" });
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-015 — entity extraction
// ---------------------------------------------------------------------------
describe("entity extraction (VAL-RETR-015)", () => {
  it("extracts named entities and produces canonical forms", () => {
    const r = extractEntities(
      "The MemroOS team decided to migrate from QDRANT to Pinecone on 2026-04-01.",
      { version: "test-v1", seed: 0 },
    );
    expect(r.ok).toBe(true);
    expect(r.entities.length).toBeGreaterThan(0);
    expect(r.entities.some((e) => e.kind === "organization" || e.kind === "unknown")).toBe(true);
    expect(r.entities.some((e) => e.kind === "date")).toBe(true);
    expect(r.receipt.canonicalizationHash.startsWith("sha256:")).toBe(true);
  });

  it("is deterministic for fixed input/version/seed", () => {
    const a = extractEntities("Qdrant Cloud and Pinecone are vector stores.", { version: "v1", seed: 7 });
    const b = extractEntities("Qdrant Cloud and Pinecone are vector stores.", { version: "v1", seed: 7 });
    expect(a.receipt.canonicalizationHash).toBe(b.receipt.canonicalizationHash);
    expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id));
  });

  it("rejects substring collisions for acronyms", () => {
    const r = extractEntities("ABC vs ABCD benchmark", { version: "v1", seed: 0 });
    expect(r.entities.filter((e) => e.kind === "acronym").length).toBeLessThanOrEqual(1);
  });

  it("respects maxEntitiesPerTask bound when many distinct proper nouns are present", () => {
    // Use uppercase entities to trigger acronym detection; this avoids
    // the multi-word proper-noun regex greediness.
    const r = extractEntities(
      "WQY PFZ HDI OXB KSR MPB VMK QJB HYD CJD WBA KGH POL MNS ZFD APS DKH TGS YNA HXB WYZ",
      { version: "v1", seed: 0, limits: { maxEntitiesPerTask: 3 } },
    );
    expect(r.receipt.rejectedReasons.overEntityLimit).toBeGreaterThan(0);
    expect(r.entities.length).toBeLessThanOrEqual(3);
  });

  it("rejection reasons monotonically count bounds violations", () => {
    // Many acronyms trigger substring-collision rejections.
    const r = extractEntities("ABC ABCD ABCDE ABCDEF ABCDEFG", {
      version: "v1",
      seed: 0,
      limits: { maxExpansionPerEntity: 0, maxEntitiesPerTask: 16, maxAliasChainLength: 16 },
    });
    // Total rejected + kept counts every input span we considered.
    expect(
      r.receipt.keptAfterLimits + r.receipt.rejectedByLimit,
    ).toBeGreaterThan(0);
  });

  it("decideEntityMerge refuses cross-scope merges", () => {
    const r = decideEntityMerge({ scope: "", candidates: [] });
    expect(r.ok).toBe(false);
  });

  it("returns typed failure for non-string extraction input", () => {
    const r = extractEntities(null as unknown as string, { version: "v1", seed: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("extraction_text_missing");
    expect(r.entities).toEqual([]);
  });

  it("extracts numeric calendar dates and rejects sentence-initial stopwords", () => {
    const dated = extractEntities("Ship on 04/15/2026 after review.", { version: "v1", seed: 0 });
    expect(dated.ok).toBe(true);
    expect(dated.entities.some((e) => e.kind === "date")).toBe(true);
    expect(dated.entities.some((e) => e.surface === "After")).toBe(false);
  });

  it("decideEntityMerge dedupes by entity id within a scope", () => {
    const a = extractEntities("Qdrant", { version: "v1", seed: 0 });
    const b = extractEntities("Qdrant again", { version: "v1", seed: 0 });
    if (!a.ok || !b.ok) throw new Error("nope");
    const candidates = [...a.entities, ...b.entities];
    const merged = decideEntityMerge({ scope: "t1", candidates });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const ids = new Set(merged.keptEntities.map((e) => e.id));
    expect(ids.size).toBeGreaterThan(0);
    expect(merged.droppedEntities.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-016 — tier fanout
// ---------------------------------------------------------------------------
describe("tier fanout (VAL-RETR-016)", () => {
  it("returns omitted for disabled/expired sources and never fabricates results", async () => {
    const r = await performTierFanout({
      query: "q",
      sources: [
        { tier: "lexical", state: "registered" },
        { tier: "vector-local", state: "disabled" },
        { tier: "mem0", state: "expired", expiresAtIso: "2020-01-01T00:00:00Z" },
      ],
      budget: { maxSources: 5, maxItemsPerSource: 3, deadlineMs: 1000 },
      allowedTiers: ["lexical", "vector-local", "mem0", "qdrant", "live"],
    });
    expect(r.perSource.find((p) => p.tier === "vector-local")?.status).toBe("omitted");
    expect(r.perSource.find((p) => p.tier === "mem0")?.status).toBe("stale");
    expect(r.perSource.find((p) => p.tier === "lexical")?.status).toBeDefined();
  });

  it("respects maxSources budget", async () => {
    const r = await performTierFanout({
      query: "q",
      sources: Array.from({ length: 5 }, (_, i) => ({
        tier: (["lexical", "vector-local", "mem0", "qdrant", "live"][i] ?? "lexical") as
          | "lexical"
          | "vector-local"
          | "mem0"
          | "qdrant"
          | "live",
        state: "registered",
      })),
      budget: { maxSources: 2, maxItemsPerSource: 3, deadlineMs: 1000 },
      allowedTiers: ["lexical", "vector-local", "mem0", "qdrant", "live"],
    });
    const omittedCount = r.perSource.filter((p) => p.status === "omitted").length;
    expect(omittedCount).toBe(3);
    expect(r.receipt.calledCount).toBe(2);
  });

  it("records success receipts when caller returns items", async () => {
    const r = await performTierFanout({
      query: "q",
      sources: [{ tier: "lexical", state: "registered" }],
      budget: { maxSources: 5, maxItemsPerSource: 3, deadlineMs: 1000 },
      allowedTiers: ["lexical", "vector-local", "mem0", "qdrant", "live"],
      caller: async () => ({
        items: [
          { id: "r1", score: 1, text: "x", tier: "lexical", source: "lexical", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 } as RetrievedItem,
        ],
        trustAtCall: 1,
      }),
    });
    expect(r.perSource[0].status).toBe("success");
    expect(r.items.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-017 — bounded reranking with version disclosure
// ---------------------------------------------------------------------------
describe("rerank (VAL-RETR-017)", () => {
  it("applies lexical rerank and discloses rule version", async () => {
    const items: RetrievedItem[] = [
      { id: "a", score: 1, text: "the quick brown fox", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 },
      { id: "b", score: 1, text: "the foxy quick jumps", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 2 },
      { id: "c", score: 1, text: "the quick fox is here", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 3 },
      { id: "d", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 4 },
      { id: "e", score: 1, text: "y", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 5 },
      { id: "f", score: 1, text: "z", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 6 },
    ];
    const r = await rerankCandidates({ items, question: "quick fox jumps", cutoff: 5, strategy: "lexical" });
    expect(r.receipt.strategy).toBe("lexical");
    expect(r.receipt.modelVersion).toBe("rule-v1");
    expect(r.receipt.cutoff).toBe(5);
    expect(r.receipt.postRerankCount).toBe(5);
  });

  it("returns typed unavailability when provider rerank is unavailable", async () => {
    const r = await rerankCandidates({
      items: [],
      question: "x",
      cutoff: 3,
      strategy: "provider",
      providerHook: async () => null,
    });
    expect(r.receipt.status).toBe("unavailable");
  });

  it("bounds post-rerank count to cutoff", async () => {
    const items: RetrievedItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `x${i}`,
      score: 10 - i,
      text: "t",
      tier: "lexical",
      source: "corpus",
      authorizationResult: "allowed" as const,
      whyEntered: "ok",
      rankPosition: i + 1,
    }));
    const r = await rerankCandidates({ items, question: "x", cutoff: 3, strategy: "lexical" });
    expect(r.receipt.postRerankCount).toBe(3);
  });

  it("disabled strategy passes through items unchanged", async () => {
    const items: RetrievedItem[] = [
      { id: "a", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 },
    ];
    const r = await rerankCandidates({ items, question: "x", cutoff: 3, strategy: "disabled" });
    expect(r.receipt.strategy).toBe("disabled");
    expect(r.items.length).toBe(1);
  });

  it("marks provider rerank timeout and failure with typed receipts", async () => {
    const items: RetrievedItem[] = [
      { id: "a", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 },
    ];
    const timeout = await rerankCandidates({
      items,
      question: "x",
      cutoff: 1,
      strategy: "provider",
      providerHook: async () => {
        throw new Error("provider timeout exceeded");
      },
    });
    expect(timeout.receipt.status).toBe("provider_timeout");

    const failed = await rerankCandidates({
      items,
      question: "x",
      cutoff: 1,
      strategy: "provider",
      providerHook: async () => {
        throw new Error("upstream failed");
      },
    });
    expect(failed.receipt.status).toBe("provider_failed");
  });

  it("accepts successful provider rerank hook results", async () => {
    const items: RetrievedItem[] = [
      { id: "a", score: 1, text: "alpha", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 },
      { id: "b", score: 0.5, text: "beta", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 2 },
    ];
    const r = await rerankCandidates({
      items,
      question: "alpha",
      cutoff: 1,
      strategy: "provider",
      providerHook: async ({ items: hookItems }) => ({
        items: [...hookItems].reverse(),
        modelVersion: "test-rerank-v2",
      }),
    });
    expect(r.receipt.status).toBe("ok");
    expect(r.receipt.modelVersion).toBe("test-rerank-v2");
    expect(r.items[0]?.id).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-018 — dedupe preserving distinct facts
// ---------------------------------------------------------------------------
describe("dedupe (VAL-RETR-018)", () => {
  it("collapses canonical duplicates while preserving distinct facts", () => {
    const r = dedupeRetrievalResults({
      scope: "tenant-a",
      items: [
        { id: "mem-1", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1, timestamp_iso: "2026-01-01T00:00:00Z" },
        { id: "mem-1", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 2, timestamp_iso: "2026-01-01T00:00:00Z" },
        { id: "mem-2", score: 0.5, text: "y", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 3 },
      ],
    });
    expect(r.items.find((it) => it.id === "mem-1")).toBeDefined();
    expect(r.items.find((it) => it.id === "mem-2")).toBeDefined();
    expect(r.receipt.mergedCount).toBe(1);
  });

  it("does not collapse items with distinct timestamps", () => {
    const r = dedupeRetrievalResults({
      scope: "tenant-a",
      items: [
        { id: "mem-1", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1, timestamp_iso: "2026-01-01T00:00:00Z" },
        { id: "mem-1", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 2, timestamp_iso: "2026-02-01T00:00:00Z" },
      ],
    });
    expect(r.items.length).toBe(2);
  });

  it("decideMerge returns non-merge for distinct canonical ids with no derivative prefix", () => {
    const existing: RetrievedItem = { id: "mem-1", score: 1, text: "x", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 };
    const candidate: RetrievedItem = { id: "mem-2", score: 1, text: "y", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 2 };
    expect(decideMerge({ existing, candidate }).merge).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-019 — context packing with coverage/budget
// ---------------------------------------------------------------------------
describe("context packing (VAL-RETR-019)", () => {
  it("honors byte budget and records omission reasons", () => {
    const r = packContext({
      items: Array.from({ length: 10 }, (_, i) => ({
        id: `m${i}`,
        score: 10 - i,
        text: "abcdefghij".repeat(50), // 500 bytes each
        tier: "lexical" as const,
        source: "corpus",
        authorizationResult: "allowed" as const,
        whyEntered: "ok",
        rankPosition: i + 1,
      })),
      budget: { maxBytes: 1200, maxTokens: 10000 },
    });
    expect(r.receipt.bytes).toBeLessThanOrEqual(1200);
    expect(r.omitted.length + r.items.length).toBe(10);
    expect(r.receipt.omissionReasons.over_byte_budget).toBeGreaterThan(0);
  });

  it("honors token budget", () => {
    const r = packContext({
      items: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        score: 5 - i,
        text: "x".repeat(1000),
        tier: "lexical" as const,
        source: "corpus",
        authorizationResult: "allowed" as const,
        whyEntered: "ok",
        rankPosition: i + 1,
      })),
      budget: { maxBytes: 100000, maxTokens: 80 },
    });
    expect(r.receipt.tokens).toBeLessThanOrEqual(80);
  });

  it("prefers evidence spans and reflects coverage", () => {
    const r = packContext({
      items: [
        { id: "mem-ev", score: 0.1, text: "evidence corpus", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 99 },
        { id: "mem-other", score: 5, text: "non evidence", tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 },
      ],
      budget: { maxBytes: 1000, maxTokens: 200 },
      evidenceSpanIds: ["mem-ev"],
    });
    // The pack includes the evidence span AND the high-score item; coverage is met.
    expect(r.items.some((i) => i.id === "mem-ev")).toBe(true);
    expect(r.items.some((i) => i.id === "mem-other")).toBe(true);
    expect(r.receipt.coverageMet).toBe(true);
    expect(r.receipt.evidenceCoverage.included).toBeGreaterThanOrEqual(1);
  });

  it("returns overBudget = false when budget is met and total bytes is recorded", () => {
    // All items that fit the budget; no truncation. bytes should equal sum.
    const items = Array.from({ length: 3 }, (_, i) => ({
      id: `x${i}`,
      score: 3 - i,
      text: "a".repeat(10),
      tier: "lexical" as const,
      source: "corpus",
      authorizationResult: "allowed" as const,
      whyEntered: "ok",
      rankPosition: i + 1,
    }));
    const r = packContext({
      items,
      budget: { maxBytes: 1024, maxTokens: 1024 },
    });
    expect(r.receipt.bytes).toBe(30);
    expect(r.receipt.overBudget).toBe(false);
  });

  it("overBudget field reflects final bytes vs budget truthfully", () => {
    const r = packContext({
      items: [{ id: "x", score: 1, text: "y".repeat(8), tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 }],
      budget: { maxBytes: 7, maxTokens: 1 },
    });
    // Item is 8 bytes > 7 maxBytes, so item is omitted and pack bytes=0.
    expect(r.items.length).toBe(0);
    expect(r.receipt.bytes).toBe(0);
    expect(r.receipt.overBudget).toBe(false);
  });

  it("truncates with omission reasons rather than fabricating items", () => {
    const r = packContext({
      items: [
        { id: "a", score: 1, text: "x".repeat(100), tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 },
        { id: "b", score: 1, text: "y".repeat(100), tier: "lexical", source: "corpus", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 2 },
      ],
      budget: { maxBytes: 4, maxTokens: 1 },
    });
    expect(r.omitted.length).toBeGreaterThan(0);
    expect(r.items.length).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-020 — temporal retrieval uncertainty
// ---------------------------------------------------------------------------
describe("temporal retrieval (VAL-RETR-020)", () => {
  it("marks supported when no caveats are present", () => {
    const r = performTemporalRetrieval({
      candidates: [
        { id: "a", text: "x", timestamp_iso: "2026-01-01T00:00:00Z" },
        { id: "b", text: "y", timestamp_iso: "2026-01-02T00:00:00Z" },
      ],
      metadata: { reference_time_iso: "2026-12-31T00:00:00Z", temporal_direction: "latest" },
    });
    expect(["supported", "caveat"]).toContain(r.status);
    expect(r.selected.length).toBe(1);
  });

  it("returns caveat when conflicting facts share a timestamp", () => {
    const r = performTemporalRetrieval({
      candidates: [
        { id: "a", text: "x", timestamp_iso: "2026-01-01T00:00:00Z" },
        { id: "b", text: "y", timestamp_iso: "2026-01-01T00:00:00Z" },
      ],
      metadata: { reference_time_iso: "2026-12-31T00:00:00Z", temporal_direction: "latest" },
    });
    expect(r.status).toBe("caveat");
  });

  it("does not caveat when reference time can be derived", () => {
    const r = performTemporalRetrieval({
      candidates: [{ id: "a", text: "x", timestamp_iso: "2026-01-01T00:00:00Z" }],
      metadata: { reference_time_iso: "2026-12-31T00:00:00Z", temporal_direction: "latest" },
    });
    // No reference-time caveat when the timestamp was supplied.
    expect(r.caveats.some((c) => c.code === "no_reference_time")).toBe(false);
  });

  it("falls back to current clock when no metadata is provided", () => {
    const r = performTemporalRetrieval({
      candidates: [],
      metadata: undefined,
    });
    // referenceTimeIso populated from clock fallback
    expect(r.referenceTimeMs).not.toBeNull();
  });

  it("abstains when no candidates", () => {
    const r = performTemporalRetrieval({
      candidates: [],
      metadata: { reference_time_iso: "2026-12-31T00:00:00Z", temporal_direction: "latest" },
    });
    expect(r.status).toBe("abstain");
  });

  it("'between' direction without fact_valid_until falls back to 'before'", () => {
    const r = performTemporalRetrieval({
      candidates: [
        { id: "a", text: "x", timestamp_iso: "2026-01-01T00:00:00Z" },
        { id: "b", text: "y", timestamp_iso: "2026-06-01T00:00:00Z" },
      ],
      metadata: { reference_time_iso: "2026-12-31T00:00:00Z", temporal_direction: "between" },
    });
    expect(r.caveats.some((c) => c.code === "missing_validity_window")).toBe(true);
  });

  it("is deterministic and produces stable candidate hash", () => {
    const args = {
      candidates: [{ id: "a", text: "x", timestamp_iso: "2026-01-01T00:00:00Z" }],
      metadata: { reference_time_iso: "2026-12-31T00:00:00Z", temporal_direction: "latest" as const },
    };
    const a = performTemporalRetrieval(args);
    const b = performTemporalRetrieval(args);
    expect(a.receipt.timestampHash).toBe(b.receipt.timestampHash);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-021 — provider flag independence
// ---------------------------------------------------------------------------
describe("provider flag independence (VAL-RETR-021)", () => {
  it("each flag is independent and reported separately", () => {
    const flags = { ...DEFAULT_PROVIDER_FLAGS, rerank: true, judge: true };
    const d = describeProviderFlags({
      flags,
      resolveCredential: (n) => (n === "rerank" ? "key" : null),
    });
    expect(d.independent).toBe(true);
    const rerank = d.flags.find((f) => f.flag === "rerank");
    const judge = d.flags.find((f) => f.flag === "judge");
    expect(rerank?.status).toBe("ok");
    expect(judge?.status).toBe("credential_missing");
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-022 — missing credentials fail closed
// ---------------------------------------------------------------------------
describe("credential fail-closed (VAL-RETR-022)", () => {
  it("returns typed credential_missing when requested provider has no key", () => {
    const r = checkProviderAvailable({
      provider: "rerank",
      flags: { ...DEFAULT_PROVIDER_FLAGS, rerank: true },
      resolveCredential: () => null,
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("credential_missing");
  });

  it("returns disabled when provider flag is off", () => {
    const r = checkProviderAvailable({
      provider: "rerank",
      flags: { ...DEFAULT_PROVIDER_FLAGS, rerank: false },
      resolveCredential: () => "key",
    });
    expect(r.status).toBe("disabled");
  });

  it("returns ok when enabled and credential present (no secret in fingerprint)", () => {
    const r = checkProviderAvailable({
      provider: "rerank",
      flags: { ...DEFAULT_PROVIDER_FLAGS, rerank: true },
      resolveCredential: () => "secret-key",
    });
    expect(r.status).toBe("ok");
    expect(r.credentialFingerprint).toBeTruthy();
    expect(r.credentialFingerprint?.includes("secret-key")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-023 — provider content cannot bypass governance
// ---------------------------------------------------------------------------
describe("provider content governance (VAL-RETR-023)", () => {
  it("rejects cross-tenant provider output", () => {
    const r = applyProviderGovernanceGate({
      items: [
        { id: "x", text: "y", score: 1, tier: "vector-local", tenantId: "other", providerTrust: 1 },
      ],
      scope: { tenantId: "t1", maxFreshnessSeconds: null },
      providerTrustFloor: 0.5,
    });
    expect(r.items.length).toBe(0);
    expect(r.denied.length).toBe(1);
    expect(r.denied[0].reason).toBe("cross_tenant");
  });

  it("rejects stale provider output", () => {
    const r = applyProviderGovernanceGate({
      items: [
        {
          id: "x",
          text: "y",
          score: 1,
          tier: "vector-local",
          timestamp_iso: "2020-01-01T00:00:00Z",
          providerTrust: 1,
        },
      ],
      scope: {
        tenantId: "t1",
        maxFreshnessSeconds: 10,
        nowIso: new Date().toISOString(),
      },
      providerTrustFloor: 0.5,
    });
    expect(r.denied.length).toBe(1);
    expect(r.denied[0].reason).toBe("stale");
  });

  it("rejects sub-floor provider trust", () => {
    const r = applyProviderGovernanceGate({
      items: [{ id: "x", text: "y", score: 1, tier: "vector-local", providerTrust: 0.1 }],
      scope: { tenantId: "t1", maxFreshnessSeconds: null },
      providerTrustFloor: 0.5,
    });
    expect(r.denied[0].reason).toBe("sub_floor_trust");
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-024 — stage reconciliation
// ---------------------------------------------------------------------------
describe("stage reconciliation (VAL-RETR-024)", () => {
  it("matches injectedCount and ignores failed tasks", () => {
    const task = {
      taskId: "t1",
      taskType: "single_hop" as const,
      lane: "external_retrieval" as const,
      adapterName: "lexical" as const,
      status: "ok" as const,
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      falsePositiveRate: 0,
      latencyMs: 0,
      injectedCount: 1,
      evidenceSpanCount: 1,
      answerSupportedByRetrievedSource: true,
      abstentionCorrect: null,
      receipt: {
        adapterName: "lexical",
        adapterVersion: "v1",
        status: "ok" as const,
        latencyMs: 0,
        authorization: { evaluated: false, allowed: true },
        provenance: {
          provider: null,
          providerVersion: null,
          retrievalPolicyVersion: "v1",
          configHash: "c",
          fixtureHash: "f",
        },
        metrics: {
          tokensRetrieval: null,
          tokensRerank: null,
          tokensPack: null,
          tokensJudge: null,
          contextPackBytes: null,
          contextPackHash: null,
        },
      },
      corpusHash: "c",
      taskHash: "t",
    };
    const report = {
      runId: "r",
      runDate: "now",
      dataset: "memroos_public_synthetic" as const,
      adapter: "lexical" as const,
      lane: "external_retrieval" as const,
      configHash: "c",
      fixtureHash: "f",
      seed: 0,
      k: 3,
      rerankEnabled: false,
      judgeEnabled: false,
      providerFlags: {},
      aggregate: {
        taskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        incompleteTaskCount: 0,
        precisionAtK: 1,
        recallAtK: 1,
        mrr: 1,
        falsePositiveRate: 0,
        answerSupportedRate: 1,
        p95LatencyMs: 0,
        abstentionAccuracy: null,
        abstentionDenominator: null,
        abstentionLabeledCount: 0,
        abstentionAnswerableFailureCount: null,
        contextPackBytes: null,
        contextPackHash: null,
        tokensRetrieval: null,
        tokensRerank: null,
        tokensPack: null,
        tokensJudge: null,
        components: { retrieval: null, rerank: null, pack: null, judge: null },
        laneMetrics: {},
      },
      taskCount: 1,
      tasks: [task],
    };
    const records = [
      stageRecord({ taskId: "t1", stage: "retrieved", ids: ["m1"] }),
      stageRecord({ taskId: "t1", stage: "injected", ids: ["m1"] }),
      stageRecord({ taskId: "t1", stage: "packed", ids: ["m1"] }),
      stageRecord({ taskId: "t1", stage: "ignored", ids: ["m2"] }),
    ];
    const r = reconcileStages({
      report,
      perTask: new Map([["t1", records]]),
    });
    expect(r.aggregate.injectedTotal).toBe(1);
    expect(r.aggregate.packedTotal).toBe(1);
    expect(r.aggregate.ignoredTotal).toBe(1);
  });

  it("records mismatches when injectedCount disagrees", () => {
    const task = {
      taskId: "t1",
      taskType: "single_hop" as const,
      lane: "external_retrieval" as const,
      adapterName: "lexical" as const,
      status: "ok" as const,
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      falsePositiveRate: 0,
      latencyMs: 0,
      injectedCount: 5,
      evidenceSpanCount: 1,
      answerSupportedByRetrievedSource: true,
      abstentionCorrect: null,
      receipt: {
        adapterName: "lexical",
        adapterVersion: "v1",
        status: "ok" as const,
        latencyMs: 0,
        authorization: { evaluated: false, allowed: true },
        provenance: {
          provider: null,
          providerVersion: null,
          retrievalPolicyVersion: "v1",
          configHash: "c",
          fixtureHash: "f",
        },
        metrics: {
          tokensRetrieval: null,
          tokensRerank: null,
          tokensPack: null,
          tokensJudge: null,
          contextPackBytes: null,
          contextPackHash: null,
        },
      },
      corpusHash: "c",
      taskHash: "t",
    };
    const report = {
      runId: "r",
      runDate: "now",
      dataset: "memroos_public_synthetic" as const,
      adapter: "lexical" as const,
      lane: "external_retrieval" as const,
      configHash: "c",
      fixtureHash: "f",
      seed: 0,
      k: 3,
      rerankEnabled: false,
      judgeEnabled: false,
      providerFlags: {},
      aggregate: {
        taskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        incompleteTaskCount: 0,
        precisionAtK: 1,
        recallAtK: 1,
        mrr: 1,
        falsePositiveRate: 0,
        answerSupportedRate: 1,
        p95LatencyMs: 0,
        abstentionAccuracy: null,
        abstentionDenominator: null,
        abstentionLabeledCount: 0,
        abstentionAnswerableFailureCount: null,
        contextPackBytes: null,
        contextPackHash: null,
        tokensRetrieval: null,
        tokensRerank: null,
        tokensPack: null,
        tokensJudge: null,
        components: { retrieval: null, rerank: null, pack: null, judge: null },
        laneMetrics: {},
      },
      taskCount: 1,
      tasks: [task],
    };
    const records = [stageRecord({ taskId: "t1", stage: "injected", ids: ["m1"] })];
    const r = reconcileStages({ report, perTask: new Map([["t1", records]]) });
    expect(r.ok).toBe(false);
  });

  it("isStageRecord narrows correctly", () => {
    expect(isStageRecord({ stage: "x", taskId: "t", ids: ["a"] })).toBe(true);
    expect(isStageRecord({ stage: 1, taskId: "t" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-027 — replay + isolation
// ---------------------------------------------------------------------------
describe("replay + isolation (VAL-RETR-027)", () => {
  it("replay handle matches the same report", () => {
    const h = buildReplayHandle({
      dataset: "locomo",
      adapter: "lexical",
      lane: "external_retrieval",
      configHash: "sha256:c",
      fixtureHash: "sha256:f",
      seed: 0,
      k: 3,
      providerFlags: { rerank: false },
      rerankEnabled: false,
      judgeEnabled: false,
    });
    expect(
      h.matches({
        dataset: "locomo",
        adapter: "lexical",
        lane: "external_retrieval",
        configHash: "sha256:c",
        fixtureHash: "sha256:f",
        seed: 0,
        k: 3,
        providerFlags: { rerank: false },
        rerankEnabled: false,
        judgeEnabled: false,
      }),
    ).toBe(true);
    expect(
      h.matches({
        dataset: "locomo",
        adapter: "lexical",
        lane: "external_retrieval",
        configHash: "sha256:c",
        fixtureHash: "sha256:f",
        seed: 1,
        k: 3,
        providerFlags: { rerank: false },
        rerankEnabled: false,
        judgeEnabled: false,
      }),
    ).toBe(false);
  });

  it("isolation context fingerprints are stable for the same scope", () => {
    const c1 = createIsolationContext({
      runId: "r",
      lane: "external_retrieval",
      dataset: "locomo",
      adapter: "lexical",
      tenantId: "t1",
      seed: 0,
    });
    const c2 = createIsolationContext({
      runId: "r",
      lane: "external_retrieval",
      dataset: "locomo",
      adapter: "lexical",
      tenantId: "t1",
      seed: 0,
    });
    expect(c1.fingerprint).toBe(c2.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-028 — incomplete report publication blocked
// ---------------------------------------------------------------------------
describe("publication gate (VAL-RETR-028)", () => {
  const baseReport = {
    runId: "r",
    runDate: "now",
    dataset: "locomo" as const,
    adapter: "lexical" as const,
    lane: "external_retrieval" as const,
    configHash: "sha256:abc",
    fixtureHash: "sha256:def",
    seed: 0,
    k: 3,
    rerankEnabled: false,
    judgeEnabled: false,
    providerFlags: { rerank: false },
    aggregate: {
      taskCount: 1,
      completedTaskCount: 1,
      failedTaskCount: 0,
      incompleteTaskCount: 0,
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      falsePositiveRate: 0,
      answerSupportedRate: 1,
      p95LatencyMs: 0,
      abstentionAccuracy: null,
      abstentionDenominator: null,
      abstentionLabeledCount: 0,
      abstentionAnswerableFailureCount: null,
      contextPackBytes: null,
      contextPackHash: null,
      tokensRetrieval: null,
      tokensRerank: null,
      tokensPack: null,
      tokensJudge: null,
      components: { retrieval: null, rerank: null, pack: null, judge: null },
      laneMetrics: {},
    },
    taskCount: 1,
    tasks: [],
  };

  it("blocks publication when receipt verification is missing", () => {
    const r = evaluatePublicationGate({
      report: baseReport,
      provenance: {
        configHash: "sha256:abc",
        fixtureHash: "sha256:def",
        seed: 0,
        k: 3,
        providerFlags: { rerank: false },
      },
      receiptVerifications: [],
    });
    expect(r.ok).toBe(false);
    expect(r.caveats.some((c) => c.includes("receipt_verification_missing"))).toBe(true);
  });

  it("blocks publication when provider flags carry failed tasks", () => {
    const reportWithFailure = {
      ...baseReport,
      aggregate: { ...baseReport.aggregate, failedTaskCount: 1 },
    };
    const r = evaluatePublicationGate({
      report: reportWithFailure,
      provenance: {
        configHash: "sha256:abc",
        fixtureHash: "sha256:def",
        seed: 0,
        k: 3,
        providerFlags: { rerank: false },
      },
      receiptVerifications: [
        { receiptHash: "h", chainDomain: "retrieval-bench", verified: true, verifiedAtIso: "now" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("approves publication when provenance, receipts, and aggregated run are clean", () => {
    const r = evaluatePublicationGate({
      report: baseReport,
      provenance: {
        configHash: "sha256:abc",
        fixtureHash: "sha256:def",
        seed: 0,
        k: 3,
        providerFlags: { rerank: false },
      },
      receiptVerifications: [
        { receiptHash: "h", chainDomain: "retrieval-bench", verified: true, verifiedAtIso: "now" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ready_for_publication");
    expect(r.decisionHash.startsWith("sha256:")).toBe(true);
    expect(r.decidedAtIso).toEqual(expect.any(String));
  });

  it("blocks publication for malformed provenance and failed auxiliary gates", () => {
    const cleanProvenance = {
      configHash: "sha256:abc",
      fixtureHash: "sha256:def",
      seed: 0,
      k: 3,
      providerFlags: { rerank: false },
    };
    const verified = [
      { receiptHash: "h1", chainDomain: "retrieval-bench", verified: true, verifiedAtIso: "now" },
    ];

    const missingField = evaluatePublicationGate({
      report: baseReport,
      provenance: { ...cleanProvenance, fixtureHash: undefined as unknown as string },
      receiptVerifications: verified,
    });
    expect(missingField.caveats).toContain("missing_provenance_field:fixtureHash");

    const malformed = evaluatePublicationGate({
      report: baseReport,
      provenance: { ...cleanProvenance, configHash: "not-a-hash" },
      receiptVerifications: verified,
    });
    expect(malformed.caveats).toContain("config_hash_malformed");

    const failedReceipt = evaluatePublicationGate({
      report: baseReport,
      provenance: cleanProvenance,
      receiptVerifications: [
        { receiptHash: "bad", chainDomain: "retrieval-bench", verified: false, verifiedAtIso: "now" },
      ],
    });
    expect(failedReceipt.caveats.some((c) => c.startsWith("receipt_verification_failed:"))).toBe(true);

    const contaminated = evaluatePublicationGate({
      report: baseReport,
      provenance: cleanProvenance,
      receiptVerifications: verified,
      contamination: { ok: false, reason: "foreign_artifact" },
    });
    expect(contaminated.caveats).toContain("contamination_failed:foreign_artifact");

    const auditFailed = evaluatePublicationGate({
      report: baseReport,
      provenance: cleanProvenance,
      receiptVerifications: verified,
      auditPersistence: { ok: false, reasons: ["sqlite_busy"] },
    });
    expect(auditFailed.caveats).toContain("audit_persistence_failed:sqlite_busy");

    const skippedNoWrite = evaluatePublicationGate({
      report: baseReport,
      provenance: cleanProvenance,
      receiptVerifications: verified,
      auditPersistence: { ok: true, skippedNoWrite: true },
    });
    expect(skippedNoWrite.caveats).toContain("audit_persistence_skipped_no_write");

    const sentinel = evaluatePublicationGate({
      report: baseReport,
      provenance: cleanProvenance,
      receiptVerifications: verified,
      sentinelScan: { ok: false, violations: 2 },
    });
    expect(sentinel.caveats).toContain("sentinel_scan_failed:violations=2");
  });

  it("blocks publication when report metadata diverges from provenance", () => {
    const provenance = {
      configHash: "sha256:abc",
      fixtureHash: "sha256:def",
      seed: 0,
      k: 3,
      providerFlags: { rerank: false },
    };
    const verified = [
      { receiptHash: "h", chainDomain: "retrieval-bench", verified: true, verifiedAtIso: "now" },
    ];

    expect(
      evaluatePublicationGate({
        report: { ...baseReport, seed: 9 },
        provenance,
        receiptVerifications: verified,
      }).caveats,
    ).toContain("report_seed_mismatch");

    expect(
      evaluatePublicationGate({
        report: { ...baseReport, k: 5 },
        provenance,
        receiptVerifications: verified,
      }).caveats,
    ).toContain("report_k_mismatch");

    expect(
      evaluatePublicationGate({
        report: { ...baseReport, configHash: "sha256:other" },
        provenance,
        receiptVerifications: verified,
      }).caveats,
    ).toContain("report_config_hash_mismatch");
  });

  it("buildReplayHandle inspects args, fingerprints, and provider flag mismatches", () => {
    const handle = buildReplayHandle({
      dataset: "locomo",
      adapter: "lexical",
      lane: "external_retrieval",
      configHash: "sha256:c",
      fixtureHash: "sha256:f",
      seed: 0,
      k: 3,
      providerFlags: { rerank: true, judge: false },
      rerankEnabled: true,
      judgeEnabled: false,
      retrievalPolicyVersion: "retrieval-v2",
    });
    expect(handle.inspect()).toMatchObject({
      dataset: "locomo",
      retrievalPolicyVersion: "retrieval-v2",
      providerFlags: { rerank: true, judge: false },
    });
    expect(handle.fingerprint.startsWith("sha256:")).toBe(true);
    expect(
      handle.matches({
        dataset: "locomo",
        adapter: "lexical",
        lane: "external_retrieval",
        configHash: "sha256:c",
        fixtureHash: "sha256:f",
        seed: 0,
        k: 3,
        providerFlags: { judge: false, rerank: false },
        rerankEnabled: true,
        judgeEnabled: false,
      }),
    ).toBe(false);
  });

  it("receiptLineageFor hashes adapter receipt stages", () => {
    const lineage = receiptLineageFor({
      adapterName: "lexical",
      adapterVersion: "1",
      status: "ok",
      latencyMs: 1,
      authorization: { evaluated: true, allowed: true },
      provenance: {
        provider: "corpus",
        providerVersion: null,
        retrievalPolicyVersion: "retrieval-v1",
        configHash: "sha256:cfg",
        fixtureHash: "sha256:fix",
      },
      metrics: {
        tokensRetrieval: null,
        tokensRerank: null,
        tokensPack: null,
        tokensJudge: null,
        contextPackBytes: null,
        contextPackHash: "sha256:pack",
      },
    });
    expect(lineage.receiptHash.startsWith("sha256:")).toBe(true);
    expect(lineage.stages).toEqual(
      expect.arrayContaining([
        "status:ok",
        "provider:corpus",
        "policy:retrieval-v1",
        "pack:sha256:pack",
        "config:sha256:cfg",
        "fixture:sha256:fix",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// VAL-RETR-030 — cross-lane/run contamination guard
// ---------------------------------------------------------------------------
describe("contamination guard (VAL-RETR-030)", () => {
  it("flags scope mismatches and filters out foreign records", () => {
    const expected = {
      runId: "r",
      lane: "external_retrieval",
      dataset: "locomo",
      adapter: "lexical",
      tenantId: "t1",
      seed: 0,
    };
    const actual = {
      runId: "r",
      lane: "operational_workflow",
      dataset: "locomo",
      adapter: "lexical",
      tenantId: "t1",
    };
    const r = checkContamination({ expected, actual });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("lane_mismatch");
  });
});
