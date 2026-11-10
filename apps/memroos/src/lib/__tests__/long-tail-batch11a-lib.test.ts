// @vitest-environment node
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { A2A_HTTP_JSON_ROUTES, A2A_JSON_RPC_METHODS } from "@/lib/a2a/bindings";
import { getAllPostSlugs, getPostBySlug } from "@/lib/blog";
import {
  buildNotionContent,
  extractNotionTitle,
  notionBlocksToText,
  richTextToPlain,
} from "@/lib/connectors/notion-content";
import {
  MAX_BLOCK_DEPTH,
  MAX_BLOCK_REQUESTS_PER_PAGE,
  MAX_PAGE_TEXT_CHARS,
  NOTION_VERSION,
} from "@/lib/connectors/notion-fetch";
import { runCovePipeline } from "@/lib/cove";
import { initSchema } from "@/lib/db-schema";
import { createBuiltInScorers, scorerIdsForLayer } from "@/lib/evals/scorers";
import type { EvalScoringContext } from "@/lib/evals/types";
import { evaluateRecollectionTrigger } from "@/lib/gsd/proactive-recollection";
import { aggregateKpis, computeWeightedScore } from "@/lib/l3/l3-scorer";
import { summarizeAgentCliProcesses } from "@/lib/local-agent-runtime";
import {
  buildMemoryDoctorDiagnostic,
  formatMemoryDoctorReport,
  isMemoryDoctorCommand,
} from "@/lib/memory-doctor";
import {
  authorizeMemoryUse,
  extractMemoryLabelSnapshot,
  resolveActorSpaceIds,
} from "@/lib/memory/policy-gate";
import {
  getMemoryTrace,
  getMemoryTraceTimeline,
  recordMemoryTrace,
} from "@/lib/memory-trace-observability";
import { processNativeMemoryIngest } from "@/lib/native-memory/sink";
import {
  listSessionJsonlFiles,
  OBSERVE_HARNESS_PATHS,
  resolveObserveRoots,
} from "@/lib/observe-sidecar";
import { authenticateTenantRequest } from "@/lib/public-api/auth";
import {
  LANE_METADATA,
  partitionScoresByLane,
  resolveLaneForDataset,
  verifyLaneAssignments,
} from "@/lib/retrieval-bench/lanes";
import type { TaskScore } from "@/lib/retrieval-bench/schema";
import {
  reconcileStages,
  RECONCILIATION_STAGE_VERSION,
  stageRecord,
} from "@/lib/retrieval-bench/modules/reconciliation";
import { createAgentVersion } from "@/lib/agent-cicd-gates";
import { verifyKnowledgeAuditChain } from "@/lib/audit/knowledge-chain";
import { verifyMemoryAuditChain } from "@/lib/audit/memory-chain";
import { createSplits } from "@/lib/skillforge/eval-gate";
import { SKILLFORGE_SANDBOX_SCORER_VERSION } from "@/lib/skillforge/behavioral-sandbox-scorer";
import { createSpace } from "@/lib/space";
import { isSpaceShared, setSpaceShared } from "@/lib/shared-space";
import { stopRetentionExpiryScheduler } from "@/lib/memory-retention-expiry-scheduler";
import { readVaultArtifact, VaultHashMismatchError, writeVaultArtifact } from "@/lib/vault/writer";

describe("long-tail batch 11a — lib modules", () => {
  afterEach(() => {
    stopRetentionExpiryScheduler();
  });

  it("A2A binding route catalogs are non-empty", () => {
    expect(A2A_HTTP_JSON_ROUTES.length).toBeGreaterThan(0);
    expect(A2A_JSON_RPC_METHODS).toContain("message/send");
  });

  it("blog helpers tolerate missing content dir", () => {
    expect(Array.isArray(getAllPostSlugs())).toBe(true);
    expect(getPostBySlug("definitely-missing-slug-batch11a")).toBeNull();
  });

  it("Notion content helpers flatten rich text and blocks", () => {
    expect(richTextToPlain([{ plain_text: "hello" }, { text: { content: " world" } }])).toBe("hello world");
    expect(
      extractNotionTitle({
        properties: { Name: { type: "title", title: [{ plain_text: "Page A" }] } },
      })
    ).toBe("Page A");
    const body = notionBlocksToText([
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "line one" }] } },
      { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] } },
    ]);
    expect(body).toContain("line one");
    expect(body).toContain("# Title");
    expect(buildNotionContent({ title: "T", bodyText: "B" })).toBe("T\n\nB");
  });

  it("Notion fetch module exports bounded constants", () => {
    expect(NOTION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MAX_BLOCK_DEPTH).toBeGreaterThan(0);
    expect(MAX_BLOCK_REQUESTS_PER_PAGE).toBeGreaterThan(0);
    expect(MAX_PAGE_TEXT_CHARS).toBe(12_000);
  });

  it("benchmark lanes resolve locomo and verify assignments", () => {
    const lane = resolveLaneForDataset("locomo");
    expect(lane.ok).toBe(true);
    expect(lane.lane).toBe("external_retrieval");
    expect(verifyLaneAssignments().ok).toBe(true);
    expect(LANE_METADATA.external_retrieval.datasets).toContain("locomo");
    const partitioned = partitionScoresByLane([
      { taskId: "t1", lane: "external_retrieval" } as TaskScore,
    ]);
    expect(partitioned.external_retrieval).toHaveLength(1);
  });

  it("reconciliation stage receipt aggregates injected ids", () => {
    const report = {
      runId: "batch11",
      runDate: "now",
      dataset: "locomo" as const,
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
      tasks: [
        {
          taskId: "t1",
          taskType: "single_hop" as const,
          injectedCount: 1,
          ignoredCount: 0,
          packedCount: 1,
          rerankedCount: 0,
          dedupedCount: 0,
          retrievedCount: 1,
          temporalSelectedCount: 0,
          status: "completed" as const,
        },
      ],
    };
    const records = [
      stageRecord({ taskId: "t1", stage: "retrieved", ids: ["m1"] }),
      stageRecord({ taskId: "t1", stage: "injected", ids: ["m1"] }),
      stageRecord({ taskId: "t1", stage: "packed", ids: ["m1"] }),
    ];
    const receipt = reconcileStages({ report, perTask: new Map([["t1", records]]) });
    expect(receipt.stageVersion).toBe(RECONCILIATION_STAGE_VERSION);
    expect(receipt.ok).toBe(true);
    expect(receipt.aggregate.injectedTotal).toBe(1);
  });

  it("CoVe pipeline short-circuits when disabled", async () => {
    const result = await runCovePipeline({
      input: "question",
      draft: "answer",
      config: { enabled: false, maxVerificationQuestions: 3, parallelVerification: false },
    });
    expect(result.revisedAnswer).toBe("answer");
    expect(result.trace.questions).toEqual([]);
  });

  it("observe sidecar resolves harness roots under home", () => {
    expect(OBSERVE_HARNESS_PATHS.some((row) => row.harness === "claude")).toBe(true);
    const roots = resolveObserveRoots("claude");
    expect(roots.length).toBeGreaterThan(0);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "observe-batch11-"));
    const sessionDir = path.join(tmp, "nested");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "session.jsonl"), '{"type":"event"}\n');
    expect(listSessionJsonlFiles(tmp).some((file) => file.endsWith("session.jsonl"))).toBe(true);
  });

  it("memory trace round-trip writes efficiency telemetry", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${crypto.randomUUID()}`;
    const trace = recordMemoryTrace(db, {
      runId,
      causalPath: {
        contextAssembly: "ctx",
        retrievalQuery: "query",
        retrievedCandidates: [{ id: "m1", content: "fact", score: 0.9 }],
        policyFilters: [],
        promptInclusion: true,
      },
    });
    expect(trace.runId).toBe(runId);
    const loaded = getMemoryTrace(db, "default-tenant", runId);
    expect(loaded?.id).toBe(trace.id);
    expect(getMemoryTraceTimeline(trace).length).toBeGreaterThan(0);
    db.close();
  });

  it("public API tenant auth accepts seeded keys and rejects revoked", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const rawKey = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
    db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run("tenant-a", "Tenant A");
    db.prepare(
      "INSERT INTO tenant_api_keys (id, tenant_id, key_hash, scopes, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
    ).run("tak-batch11", "tenant-a", hash, "read,write", new Date().toISOString());

    const ok = authenticateTenantRequest(
      new Request("https://example.com", { headers: { Authorization: `Bearer ${rawKey}` } }),
      db
    );
    expect(ok?.tenantId).toBe("tenant-a");
    expect(ok?.scopes).toContain("read");

    db.prepare("UPDATE tenant_api_keys SET revoked_at = ? WHERE key_hash = ?").run(
      new Date().toISOString(),
      hash
    );
    expect(
      authenticateTenantRequest(
        new Request("https://example.com", { headers: { Authorization: `Bearer ${rawKey}` } }),
        db
      )
    ).toBeNull();
    db.close();
  });

  it("shared-space toggle marks space read-only", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const space = createSpace(db, { tenantId: "default-tenant", name: `shared-${crypto.randomUUID()}` });
    expect(isSpaceShared(db, space.id)).toBe(false);
    setSpaceShared(db, { spaceId: space.id, isShared: true, actorId: "operator-1", reason: "review" });
    expect(isSpaceShared(db, space.id)).toBe(true);
    db.close();
  });

  it("memory policy gate enforces space membership and redaction", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const spaceDenied = authorizeMemoryUse({
      actor: { id: "agent-a", role: "agent", spaceIds: [] },
      purpose: "memory_search",
      label: { visibility: "internal", policy: "indexable", spaceId: "space-x" },
    });
    expect(spaceDenied.reason).toBe("space_not_member");

    const redact = authorizeMemoryUse({
      actor: { id: "op", role: "operator" },
      purpose: "recall",
      label: { visibility: "internal", policy: "requires_redaction" },
    });
    expect(redact.decision).toBe("redact");

    const snapshot = extractMemoryLabelSnapshot({ space_id: "s1", policy: "indexable", visibility: "internal" });
    expect(snapshot?.spaceId).toBe("s1");
    expect(resolveActorSpaceIds(db, { id: "nobody", role: "anonymous" })).toEqual([]);
    db.close();
  });

  it("native memory ingest returns sanitized replay payload", () => {
    const result = processNativeMemoryIngest({
      source: "claude",
      agentId: "agent-1",
      userId: "user-1",
      content: "remember: ship the feature",
      memoryPath: "/tmp/memory.md",
      canonicalContent: "remember: ship the feature",
    });
    expect(result.replay.length).toBeGreaterThan(0);
    expect(result.enforcement).toBeTruthy();
  });

  it("proactive recollection skips blank tasks", () => {
    const receipt = evaluateRecollectionTrigger({
      timing: "before_plan",
      taskText: "   ",
      projectId: "proj-a",
    });
    expect(receipt.action).toBe("skip");
    expect(receipt.skipReason).toBe("blank_task");
  });

  it("local agent runtime summary detects CLI processes", () => {
    const ps = `
      101 1 /usr/bin/node /path/to/hermes_cli.main.js
      102 1 tmux new-session
      103 1 /usr/bin/claude --help
    `;
    const summary = summarizeAgentCliProcesses(ps, "2026-01-01T00:00:00.000Z");
    expect(summary.activeCliCount).toBeGreaterThan(0);
    expect(summary.byPlatform.hermes).toBe(1);
  });

  it("memory doctor command detector and report formatting", () => {
    expect(isMemoryDoctorCommand("/doctor memory")).toBe(true);
    expect(isMemoryDoctorCommand("hello")).toBe(false);
    const db = new Database(":memory:");
    initSchema(db);
    const diagnostic = buildMemoryDoctorDiagnostic(db);
    expect(diagnostic.memoryIteration.status).toBeTruthy();
    expect(formatMemoryDoctorReport(diagnostic)).toContain("Memory Doctor");
    db.close();
  });

  it("audit chains verify cleanly on empty tenants", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(verifyKnowledgeAuditChain(db, "default-tenant").valid).toBe(true);
    expect(verifyMemoryAuditChain(db, "default-tenant").valid).toBe(true);
    db.close();
  });

  it("eval scorers registry exposes built-ins per layer", () => {
    const scorers = createBuiltInScorers();
    expect(scorers.some((scorer) => scorer.id === "tool_call_schema")).toBe(true);
    const context = {
      config: {
        scorers: { l1Capability: ["tool_call_schema"], l2Quality: ["on_task"], l3Outcome: ["cost_per_task"] },
      },
    } as EvalScoringContext;
    expect(scorerIdsForLayer(context, "l1")).toEqual(["tool_call_schema"]);
  });

  it("L3 KPI aggregation averages keyed events", () => {
    const kpis = aggregateKpis([
      {
        id: 1,
        tenantId: "t",
        correlationId: "c",
        sourceSystem: "intercom",
        adapter: "intercom",
        eventType: "task",
        kpiKey: "completion_rate",
        kpiValue: 0.8,
        rawJson: "{}",
        polledAt: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        tenantId: "t",
        correlationId: "c",
        sourceSystem: "intercom",
        adapter: "intercom",
        eventType: "task",
        kpiKey: "completion_rate",
        kpiValue: 1,
        rawJson: "{}",
        polledAt: "2026-01-01T00:00:01Z",
      },
    ]);
    expect(kpis.completionRate).toBeCloseTo(0.9);
    const weighted = computeWeightedScore(kpis, {
      completion_rate: 1,
      escalation_rate: 0,
      ttr_p50: 0,
      approval_rate: 0,
      cost_per_task: 0,
    });
    expect(weighted).toBeGreaterThan(0);
  });

  it("agent CI/CD version creation seeds draft gates", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const version = createAgentVersion(db, {
      agentId: "agent-batch11",
      version: "0.0.1",
      profile: "dev",
      modelRoute: { primary: "local" },
      systemInstructions: "Be helpful.",
    });
    expect(version.status).toBe("draft");
    expect(version.gatesStatus.passed).toBe(false);
    db.close();
  });

  it("skillforge split helper partitions samples deterministically", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const splits = createSplits(db, "skill-batch11", ["a", "b", "c", "d", "e"]);
    expect(splits.train.taskSamples.length).toBeGreaterThan(0);
    expect(SKILLFORGE_SANDBOX_SCORER_VERSION).toContain("skillforge");
    db.close();
  });

  it("vault read detects on-disk hash mismatch", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const prevRoot = process.env.MEMROOS_VAULT_ROOT;
    const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-batch11-"));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
    try {
      const written = writeVaultArtifact(db, {
        tenantId: "default-tenant",
        sourceType: "test",
        sourceId: "src",
        contentType: "text/plain",
        body: "original-body",
        labels: { policy: "indexable", visibility: "internal" },
        actorId: "operator",
      });
      db.prepare("UPDATE raw_artifacts SET content_hash = ? WHERE id = ?").run(
        "0".repeat(64),
        written.id
      );
      expect(() => readVaultArtifact(db, written.id)).toThrow(VaultHashMismatchError);
    } finally {
      if (prevRoot === undefined) delete process.env.MEMROOS_VAULT_ROOT;
      else process.env.MEMROOS_VAULT_ROOT = prevRoot;
      fs.rmSync(vaultRoot, { recursive: true, force: true });
    }
    db.close();
  });
});
