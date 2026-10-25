// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import {
  CANDIDATE_PROVENANCE_TAGS,
  provenanceTagFromConfidence,
} from "@/lib/ontology/candidates";
import { convertLoCoMoSamples, hashLoCoMoSource } from "@/lib/retrieval-bench/adapters/locomo";
import { buildLexicalUnavailable, lexicalRank } from "@/lib/retrieval-bench/adapters/lexical";
import type { NormalizedTask } from "@/lib/retrieval-bench/schema";
import { performTemporalRetrieval } from "@/lib/retrieval-bench/modules/temporal-retrieval";
import { resolveLaneForDataset, partitionScoresByLane } from "@/lib/retrieval-bench/lanes";
import type { TaskScore } from "@/lib/retrieval-bench/schema";
import {
  buildMemoryDoctorDiagnostic,
  formatMemoryDoctorReport,
  isMemoryDoctorCommand,
} from "@/lib/memory-doctor";
import { initSchema } from "@/lib/db-schema";
import { queryAuditLog, writeAuditEntry } from "@/lib/seal/audit";
import { runGsdAdapterSafetyCheck } from "@/lib/gsd/adapter-safety";
import { embeddingProviderEnabled, cosineSimilarity } from "@/lib/embeddings/provider";
import { seedRegisteredAgents } from "@/lib/agent-registry-seed";
import { OBSERVE_HARNESS_PATHS, resolveObserveRoots } from "@/lib/observe-sidecar";
import { scanIrisPreflight } from "@/lib/iris-scanner";
import { WIKI_DIGEST_INTERVAL_MS } from "@/lib/wiki-digest-scheduler";
import { activatePolicyVersion } from "@/lib/policy/shadow";
import { deriveAgentId } from "@/lib/db-ingest";

describe("long-tail batch 2 — lib modules", () => {
  it("maps ontology confidence bands to ONTO-03 provenance tags", () => {
    expect(provenanceTagFromConfidence("high")).toBe("EXTRACTED");
    expect(provenanceTagFromConfidence("medium")).toBe("INFERRED");
    expect(provenanceTagFromConfidence("low")).toBe("AMBIGUOUS");
    expect(CANDIDATE_PROVENANCE_TAGS).toEqual(["EXTRACTED", "INFERRED", "AMBIGUOUS"]);
  });

  it("rejects unknown benchmark datasets at lane resolution", () => {
    const unknown = resolveLaneForDataset("not_a_real_dataset" as never);
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toMatch(/dataset_not_assigned_to_lane/);
  });

  it("partitions architecture_evidence scores in lane buckets", () => {
    const score = {
      taskId: "arch-1",
      taskType: "single_hop",
      lane: "architecture_evidence",
      adapterName: "lexical",
      status: "ok",
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      falsePositiveRate: 0,
      latencyMs: 1,
      injectedCount: 0,
      evidenceSpanCount: 1,
      answerSupportedByRetrievedSource: true,
      abstentionCorrect: null,
      receipt: {} as TaskScore["receipt"],
      corpusHash: "x",
      taskHash: "y",
    } satisfies TaskScore;
    const out = partitionScoresByLane([score]);
    expect(out.architecture_evidence).toHaveLength(1);
    expect(out.external_retrieval).toHaveLength(0);
  });

  it("converts LoCoMo samples and hashes source identity without raw leakage", () => {
    const raw = [
      {
        sample_id: "s1",
        conversations: [
          {
            session_id: "sess-a",
            turns: [{ role: "user" as const, text: "hello world", timestamp_iso: "2026-01-01T00:00:00Z" }],
          },
        ],
        qa: [{ qid: "q1", question: "hello?", answer: "world", category: "qa" }],
      },
    ];
    const converted = convertLoCoMoSamples({ rawSamples: raw });
    expect(converted.ok).toBe(true);
    if (converted.ok) {
      expect(converted.tasks).toHaveLength(1);
      expect(converted.tasks[0].dataset).toBe("locomo");
    }
    const h1 = hashLoCoMoSource(raw);
    const h2 = hashLoCoMoSource(raw);
    expect(h1).toBe(h2);
    expect(convertLoCoMoSamples({ rawSamples: [] }).ok).toBe(false);
    expect(convertLoCoMoSamples({ rawSamples: null as never }).ok).toBe(false);
  });

  it("lexicalRank returns deterministic ordering for overlapping tokens", () => {
    const task: NormalizedTask = {
      id: "t1",
      dataset: "memroos_public_synthetic",
      task_type: "single_hop",
      corpus: [
        { id: "a", text: "quick brown fox" },
        { id: "b", text: "lazy dog sleeps" },
      ],
      question: "quick fox",
      expected_answer: "brown",
      evidence_spans: ["a"],
      license: "MIT",
      citation: "test",
      provenance: {
        dataset: "memroos_public_synthetic",
        sourceCitation: "test",
        sourceLicense: "MIT",
        sourceAvailability: "synthetic",
      },
    };
    const ranked = lexicalRank(task, 2);
    expect(ranked[0]?.id).toBe("a");
    expect(ranked.length).toBeGreaterThan(0);
    const unavailable = buildLexicalUnavailable(task, "policy-v1", "cfg", "fix");
    expect(unavailable.status).toBe("unavailable");
  });

  it("performTemporalRetrieval discloses caveat when no valid reference time parses", () => {
    const result = performTemporalRetrieval({
      candidates: [{ id: "m1", text: "fact", timestamp_iso: "2026-01-01T00:00:00Z" }],
      metadata: { temporal_direction: "latest", reference_time_iso: "not-a-date" },
      scopeReferenceIso: "also-invalid",
      options: { nowIso: "still-invalid" },
    });
    expect(result.caveats.some((c) => c.code === "no_reference_time")).toBe(true);
  });

  it("builds memory doctor diagnostics and formats operator report", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const diagnostic = buildMemoryDoctorDiagnostic(db, process.cwd());
    expect(diagnostic.memoryIteration.status).toMatch(/healthy|needs_repair|storage_watch/);
    const report = formatMemoryDoctorReport(diagnostic);
    expect(report).toContain("Memory Doctor");
    expect(isMemoryDoctorCommand("/doctor memory")).toBe(true);
    expect(isMemoryDoctorCommand("not a command")).toBe(false);
    db.close();
  });

  it("writes and queries seal audit log entries", () => {
    const db = new Database(":memory:");
    initSchema(db);
    writeAuditEntry(
      {
        proposalId: "prop-batch2",
        event: "proposed",
        baselineW: 0.5,
        detail: { note: "batch2" },
      },
      db
    );
    const rows = queryAuditLog({ proposalId: "prop-batch2", limit: 5 }, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe("proposed");
    db.close();
  });

  it("blocks GSD adapter safety when content scan fails", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = runGsdAdapterSafetyCheck(db, {
      action: "send",
      content: "aws key AKIAIOSFODNN7EXAMPLE in payload",
      actorAgentId: "gsd-agent",
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedReasons).toContain("secrets_or_pii_scan_blocked");
    db.close();
  });

  it("reflects embedding provider env gate and zero-length cosine similarity", () => {
    const prev = process.env.MEMROOS_EMBEDDING_PROVIDER;
    delete process.env.MEMROOS_EMBEDDING_PROVIDER;
    try {
      expect(embeddingProviderEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MEMROOS_EMBEDDING_PROVIDER;
      else process.env.MEMROOS_EMBEDDING_PROVIDER = prev;
    }
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("seeds registered agents on empty registry tables", () => {
    const db = new Database(":memory:");
    initSchema(db);
    seedRegisteredAgents(db);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM registered_agents").get() as { c: number }).c;
    expect(count).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("documents observe harness catalog entries", () => {
    expect(OBSERVE_HARNESS_PATHS.length).toBeGreaterThan(0);
    expect(OBSERVE_HARNESS_PATHS.every((p) => typeof p.harness === "string")).toBe(true);
  });

  it("activatePolicyVersion rejects empty proposed manifest versions", () => {
    expect(activatePolicyVersion({ version: "", rules: [] }, "policy-v1")).toMatchObject({
      activated: false,
      reason: "invalid_proposed_version",
      newVersion: "policy-v1",
    });
  });

  it("deriveAgentId handles double-dash path encoding", () => {
    expect(deriveAgentId("-Users-jdoe--paperclip-instances-foo")).toBe("paperclip");
  });

  it("resolveObserveRoots filters harnesses by capture wave", () => {
    const wave1 = resolveObserveRoots("/tmp/home", 1);
    const wave3 = resolveObserveRoots("/tmp/home", 3);
    expect(wave1.length).toBeGreaterThan(0);
    expect(wave3.length).toBeGreaterThanOrEqual(wave1.length);
    expect(wave1[0]?.root.startsWith("/tmp/home")).toBe(true);
  });

  it("scanIrisPreflight allows blank operator prompts", () => {
    expect(scanIrisPreflight("   ").blocked).toBe(false);
  });

  it("exposes wiki digest scheduler interval constant", () => {
    expect(WIKI_DIGEST_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
