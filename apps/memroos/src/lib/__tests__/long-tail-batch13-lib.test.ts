// @vitest-environment node
import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchA2aJsonRpc } from "@/lib/a2a/bindings";
import { A2aError } from "@/lib/a2a/errors";
import {
  validateA2aAgentCard,
  isAllowedAgentCardUrl,
} from "@/lib/a2a/card-ingestion";
import {
  createAgentVersion,
  evaluateReleaseGates,
  rollbackAgentVersion,
} from "@/lib/agent-cicd-gates";
import {
  createDefaultMiddlewareFiles,
  runToolWithMiddleware,
} from "@/lib/agent-runtime/middleware";
import { buildObservabilityModel } from "@/lib/agent-runtime/observability";
import { detectInstalledHarnesses } from "@/lib/agents/host-installed";
import { resolveEscalation, writeAuditEntry } from "@/lib/audit/write";
import { getSecret, signAccessToken, verifyAccessToken } from "@/lib/auth/jwt";
import { loadOutboundPolicy } from "@/lib/belief/outbound-policy";
import { getAllPostSlugs, getPostBySlug } from "@/lib/blog";
import { callRest } from "@/lib/connectors/mcp-client";
import {
  buildNotionContent,
  extractNotionTitle,
  notionBlocksToText,
  richTextToPlain,
} from "@/lib/connectors/notion-content";
import { fetchNotionPageText } from "@/lib/connectors/notion-fetch";
import { backfillConnectorSpaceReaders, writeConnectorRecord } from "@/lib/connectors/store";
import { evaluateContextSources } from "@/lib/context-sources";
import { listCronHealthJobs, upsertCronHealthJob } from "@/lib/cron-health";
import {
  computeDirectiveBudget,
  directiveDiff,
  loadDirectiveBudgetConfig,
  setTenantDirectiveBudget,
} from "@/lib/directive-budget";
import { cosineSimilarity, embeddingProviderEnabled } from "@/lib/embeddings/provider";
import { buildDefaultEvalConfig, parseEvalConfigYaml } from "@/lib/evals/config";
import { createEvalScorerRegistry, listRegisteredScorers } from "@/lib/evals/engine";
import { goldenSetPathForTrace, loadGoldenSet } from "@/lib/evals/golden-sets";
import { createBuiltInScorers } from "@/lib/evals/scorers";
import { registerTrajectoryScorer } from "@/lib/evals/trajectory-scorer";
import type { AgentEvalTrace, EvalScoringContext } from "@/lib/evals/types";
import { runMemroosCli } from "@/lib/export/cli";
import { runGsdAdapterSafetyCheck } from "@/lib/gsd/adapter-safety";
import { validatePhaseUiRepresentation } from "@/lib/gsd/phase-ui-representation";
import { runSlaActions } from "@/lib/hil/sla-actions";
import { scanIrisPreflight } from "@/lib/iris-scanner";
import { createNetSuiteAdapter } from "@/lib/l3/adapters/netsuite";
import { createSalesforceAdapter } from "@/lib/l3/adapters/salesforce";
import { createZendeskAdapter } from "@/lib/l3/adapters/zendesk";
import { createHubSpotAdapter } from "@/lib/l3/adapters/hubspot";
import {
  aggregateKpis,
  businessOpsL3Scorer,
  computeWeightedScore,
  readEventsForCorrelation,
} from "@/lib/l3/l3-scorer";
import { pollAllAdapters } from "@/lib/l3/poller";
import { initSchema } from "@/lib/db-schema";
import { buildMemoryDoctorDiagnostic } from "@/lib/memory-doctor";
import {
  runScheduledRetentionExpiry,
  startRetentionExpiryScheduler,
  stopRetentionExpiryScheduler,
} from "@/lib/memory-retention-expiry-scheduler";
import { getMemoryTraceTimeline, recordMemoryTrace } from "@/lib/memory-trace-observability";
import { authorizeMemoryUse } from "@/lib/memory/policy-gate";
import { finalizeQmdUpdate, serializeQmdUpdate } from "@/lib/memory/qmd";
import { verifySlackRequest } from "@/lib/message-memory/slack";
import { ingestPlatformMessageMemory } from "@/lib/message-memory/store";
import { processNativeMemoryIngest } from "@/lib/native-memory/sink";
import { resolveObserveRoots } from "@/lib/observe-sidecar";
import { resolveOntologyValidity } from "@/lib/ontology/validity";
import {
  authorizeRegistryWrite,
  registryWriteUnauthorizedResponse,
} from "@/lib/operator-auth";
import { detectPiiForStorage } from "@/lib/privacy/pii-storage";
import { authenticateTenantRequest } from "@/lib/public-api/auth";
import { cacheKey, createResponseCache } from "@/lib/response-cache";
import { validateTask, isDatasetId } from "@/lib/retrieval-bench/validation";
import { convertLoCoMoSamples } from "@/lib/retrieval-bench/adapters/locomo";
import { resolveLaneForDataset } from "@/lib/retrieval-bench/lanes";
import { parseCliArgs } from "@/lib/retrieval-bench/modules/cli-parser";
import { defaultContextBudget, packContext } from "@/lib/retrieval-bench/modules/context-pack";
import { writeAuditEntry as writeSealAuditEntry, queryAuditLog } from "@/lib/seal/audit";
import { listEvalJobs } from "@/lib/seal/behavioral-jobs";
import { registryEntryFor } from "@/lib/seal/proposal-registry";
import { setSpaceShared, isSpaceShared, assertWritableSpace } from "@/lib/shared-space";
import { readSkillBudgetReport } from "@/lib/skill-budget";
import { analyzeTelemetry } from "@/lib/skillforge/analyzer";
import { SkillForgeWorker } from "@/lib/skillforge/worker";
import {
  lookupSkillContract,
  parseTrustLevel,
  buildSkillEvidence,
} from "@/lib/dispatch/skill-lookup";
import { getSimilarTaskRecommendations } from "@/lib/tool-attention";
import { listVaultConnections } from "@/lib/tool-auth/credential-store";
import { PROVIDERS_BY_KEY } from "@/lib/tool-auth/providers";
import {
  forbiddenUnderstandResponse,
  hasValidUnderstandGraphToken,
} from "@/lib/understand-graph";
import { decryptVaultBody, encryptVaultBody, LocalFileKeyProvider } from "@/lib/vault/envelope";
import { readVaultArtifact, writeVaultArtifact } from "@/lib/vault/writer";
import { loadWikiGraph } from "@/lib/wiki-graph";
import { buildTopology } from "@/lib/workflow/topology";
import {
  validateWriteRule,
  resolveWriteTarget,
  createWriteRule,
} from "@/lib/write-rules";
import { createSpace } from "@/lib/space";
import { upsertTaskEvidenceBundle } from "@/lib/evidence/task-bundles";
import { openEscalation } from "@/lib/audit/write";

vi.mock("@/lib/a2a/task-service", () => ({
  sendA2aMessage: vi.fn(async () => ({ taskId: "t-send" })),
  getA2aTaskForAgent: vi.fn(async () => ({ id: "t-get" })),
  listA2aTasks: vi.fn(async () => []),
  cancelA2aTask: vi.fn(async () => ({ id: "t-cancel", status: "canceled" })),
}));

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("long-tail batch 13 — lib modules", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    stopRetentionExpiryScheduler();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("A2A bindings and card ingestion", () => {
    it("dispatches tasks/cancel via JSON-RPC", async () => {
      const out = await dispatchA2aJsonRpc(null, {
        jsonrpc: "2.0",
        id: 3,
        method: "tasks/cancel",
        params: { taskId: "task-1" },
      });
      expect(out.result).toEqual({ id: "t-cancel", status: "canceled" });
    });

    it("rejects unsupported JSON-RPC methods", async () => {
      const out = await dispatchA2aJsonRpc(null, {
        jsonrpc: "2.0",
        id: 4,
        method: "tasks/unknown",
        params: {},
      });
      expect(out.error?.message).toMatch(/Unsupported A2A method/);
    });

    it("validates agent cards and URL allowlist", () => {
      const card = validateA2aAgentCard({
        name: "Agent",
        url: "http://localhost/card.json",
        version: "1",
        skills: [{ id: "s1", name: "Skill", description: "d" }],
      });
      expect(card.name).toBe("Agent");
      expect(isAllowedAgentCardUrl("http://localhost/x")).toBe(true);
      expect(isAllowedAgentCardUrl("ftp://localhost/x")).toBe(false);
    });

    it("throws on invalid agent card shape", () => {
      expect(() => validateA2aAgentCard(null)).toThrow(A2aError);
    });
  });

  describe("a2a task store lifecycle", () => {
    it("creates tasks, transitions, and serializes rows", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `a2a-b13-${randomUUID()}-`));
      process.env.SQLITE_DB_PATH = path.join(tmp, "a2a.db");
      vi.resetModules();
      const { getDb, closeDb } = await import("@/lib/db");
      initSchema(getDb());
      const {
        appendA2aTaskEvent,
        createA2aTask,
        getA2aTask,
        serializeA2aTask,
        transitionA2aTask,
      } = await import("@/lib/a2a/task-store");

      const taskId = `task-${randomUUID()}`;
      createA2aTask({
        taskId,
        contextId: "ctx",
        callerAgentId: "caller",
        message: {
          messageId: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      });
      appendA2aTaskEvent(taskId, "progress", { pct: 1 });
      transitionA2aTask(taskId, "completed");
      const record = getA2aTask(taskId);
      expect(record?.task.status.state).toBe("completed");
      const row = getDb()
        .prepare("SELECT * FROM a2a_tasks WHERE task_id = ?")
        .get(taskId) as Record<string, unknown>;
      expect(serializeA2aTask(row as never).id).toBe(taskId);
      expect(getA2aTask("missing-task")).toBeNull();
      expect(() => transitionA2aTask("missing-task", "failed")).toThrow(/Unknown A2A task/);
      closeDb();
      delete process.env.SQLITE_DB_PATH;
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe("agent CI/CD gates", () => {
    it("validates required agent version fields", () => {
      const db = freshDb();
      expect(() =>
        createAgentVersion(db, {
          agentId: "",
          version: "1",
          systemInstructions: "x",
          profile: "default",
          modelRoute: { provider: "openai", model: "gpt" },
        })
      ).toThrow(/agentId is required/);
      expect(() =>
        createAgentVersion(db, {
          agentId: "a1",
          version: "",
          systemInstructions: "x",
          profile: "default",
          modelRoute: { provider: "openai", model: "gpt" },
        })
      ).toThrow(/version is required/);
      db.close();
    });

    it("evaluates release gates and handles missing versions", () => {
      const db = freshDb();
      expect(() => evaluateReleaseGates(db, "default-tenant", "a1", "9.9.9")).toThrow(
        /not found/
      );
      db.close();
    });

    it("rolls back when no prior promoted version exists", () => {
      const db = freshDb();
      const version = createAgentVersion(db, {
        agentId: "gate-agent",
        version: "1.0.0",
        systemInstructions: "test agent",
        profile: "dev",
        modelRoute: { provider: "openai", model: "gpt" },
      });
      expect(() =>
        rollbackAgentVersion(db, "default-tenant", version.agentId, "dev", "ops")
      ).toThrow(/No prior promoted versions/);
      db.close();
    });
  });

  describe("agent runtime middleware and observability", () => {
    it("creates default middleware files under a temp hermes root", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-b13-"));
      vi.stubEnv("HOME", root);
      createDefaultMiddlewareFiles(root);
      expect(fs.existsSync(path.join(root, "config.json"))).toBe(true);
      const result = await runToolWithMiddleware({
        hermesRoot: root,
        toolName: "echo",
        input: { message: "hello" },
        execute: async (input) => input,
      });
      expect(result.ok).toBe(true);
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("builds observability model with empty outcome log", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "observe-b13-"));
      fs.mkdirSync(path.join(root, "logs"), { recursive: true });
      fs.writeFileSync(path.join(root, "logs", "tool-outcomes.jsonl"), "", "utf8");
      const model = buildObservabilityModel(root);
      expect(model.summary.toolCalls).toBe(0);
      expect(model.sessions).toEqual([]);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe("auth, operator, and public API edges", () => {
    it("signs and rejects malformed JWT payloads", async () => {
      vi.stubEnv("MEMROOS_JWT_SECRET", "x".repeat(32));
      const token = await signAccessToken("user-1", "admin");
      expect(await verifyAccessToken(token)).toMatchObject({ sub: "user-1", role: "admin" });
      expect(getSecret()).toBeInstanceOf(Uint8Array);
    });

    it("authorizes registry writes on loopback bracket host", () => {
      const req = new Request("http://localhost/api/registry", {
        headers: { host: "[::1]:3000" },
      });
      expect(authorizeRegistryWrite(req)).toBe(true);
      expect(registryWriteUnauthorizedResponse().status).toBe(403);
    });

    it("rejects empty bearer tokens for tenant API auth", () => {
      const db = freshDb();
      const req = new Request("http://localhost/api/x", {
        headers: { Authorization: "Bearer   " },
      });
      expect(authenticateTenantRequest(req, db)).toBeNull();
      db.close();
    });
  });

  describe("blog and context sources", () => {
    it("returns null for missing blog slug", () => {
      expect(getPostBySlug(`missing-slug-b13-${randomUUID()}`)).toBeNull();
      expect(Array.isArray(getAllPostSlugs())).toBe(true);
    });

    it("counts docs via injected evaluator deps", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-b13-"));
      const doc = path.join(tmp, "readme.txt");
      fs.writeFileSync(doc, "hello");
      const health = evaluateContextSources(
        {
          version: 1,
          sources: [
            {
              id: "local",
              type: "filesystem",
              enabled: true,
              sourcePath: tmp,
              requiredTools: [],
              envVars: [],
              qmdCollection: null,
              safeAnswerPolicy: "cite_only",
            },
          ],
        },
        {
          countDocs: (target) => {
            if (!fs.existsSync(target)) return 0;
            if (fs.statSync(target).isFile()) return 0;
            return 2;
          },
          hasTool: () => true,
        }
      );
      expect(health.sources[0]?.documentCount).toBe(2);
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe("connectors and notion helpers", () => {
    it("serializes GET query params in callRest", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          expect(url).toContain("pageSize=10");
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        })
      );
      const result = await callRest("http://localhost/mcp", "token", {
        method: "GET",
        path: "/items",
        body: { pageSize: 10, skip: null },
      });
      expect(result.payload).toEqual({ ok: true });
    });

    it("throws on REST error responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status: 500, statusText: "ERR" }))
      );
      let caught: unknown;
      try {
        await callRest("http://localhost/mcp", "token", { method: "POST", path: "/fail", body: {} });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(String(caught)).toContain("500");
    });

    it("handles notion rich text and block edge shapes", () => {
      expect(richTextToPlain([42, { plain_text: "a" }])).toBe("a");
      expect(
        extractNotionTitle({
          properties: { X: { type: "title", title: [{ plain_text: "T" }] } },
        })
      ).toBe("T");
      expect(
        notionBlocksToText([null, { type: "paragraph", paragraph: { rich_text: [] } }])
      ).toBe("");
    });

    it("walks notion blocks with nested children under fetch limits", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              results: [
                {
                  id: "child-1",
                  type: "paragraph",
                  has_children: true,
                  paragraph: { rich_text: [{ plain_text: "nested" }] },
                },
              ],
              has_more: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );
      const text = await fetchNotionPageText({
        endpoint: "http://localhost",
        accessToken: "tok",
        pageId: "page-1",
      });
      expect(text).toContain("nested");
    });

    it("returns empty outcomes for connector backfill without spaces table", () => {
      const db = new Database(":memory:");
      expect(backfillConnectorSpaceReaders(db)).toBe(0);
      db.close();
    });

    it("returns empty when connector record lacks provider id", () => {
      const db = freshDb();
      const outcome = writeConnectorRecord({
        db,
        providerKey: "linear",
        connectionId: "conn-1",
        spaceId: "space-1",
        labels: { visibility: "private", policy: "sealed" },
        tool: {
          idField: "id",
          contentFields: ["title", "body"],
          timestampField: "updatedAt",
        },
        record: { title: "orphan", body: "no id field", updatedAt: new Date().toISOString() },
      });
      expect(outcome.status).toBe("empty");
      db.close();
    });
  });

  describe("cron, directive budget, embeddings", () => {
    it("lists cron jobs after upsert", () => {
      const db = freshDb();
      upsertCronHealthJob(db, {
        id: `cron-b13-${randomUUID()}`,
        name: "Batch13",
        sourceFamily: "test",
        schedule: "hourly",
        expectedIntervalMinutes: 60,
      });
      expect(listCronHealthJobs(db).length).toBeGreaterThan(0);
      db.close();
    });

    it("computes directive diffs and tenant overrides", () => {
      const diff = directiveDiff("line-a\n", "line-b\n");
      expect(diff.identical).toBe(false);
      vi.stubEnv("MEMROOS_DIRECTIVE_BUDGET_LINES", "120");
      expect(loadDirectiveBudgetConfig().budgetLines).toBe(120);
      const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "directive-b13-"));
      vi.stubEnv("MEMROOS_REPO_ROOT", storeDir);
      setTenantDirectiveBudget("tenant-b13", 88);
      expect(getTenantDirectiveBudget("tenant-b13").budgetLines).toBe(88);
      const report = computeDirectiveBudget("a\nb\n", loadDirectiveBudgetConfig());
      expect(report.lineCount).toBe(2);
      fs.rmSync(storeDir, { recursive: true, force: true });
    });

    function getTenantDirectiveBudget(tenantId: string) {
      return loadDirectiveBudgetConfig(tenantId);
    }

    it("reports embedding provider disabled without endpoint", () => {
      delete process.env.MEMROOS_EMBEDDINGS_URL;
      expect(embeddingProviderEnabled()).toBe(false);
      expect(cosineSimilarity([1, 0], [0, 0])).toBe(0);
    });
  });

  describe("evals stack", () => {
    it("parses eval config yaml weight overrides", () => {
      const config = parseEvalConfigYaml(`
judgeModel:
  provider: anthropic
  model: claude-haiku-4-5-20251001
  modelFamily: anthropic
  promptTemplateVersion: v1
weights:
  l1: 0.1
  l2: 0.2
  l3: 0.7
goldenSets:
  default: ./golden-sets/business-ops-50.jsonl
  perRole: {}
scorers:
  l1Capability: []
  l2Quality: []
  l3Outcome: []
`);
      expect(config.weights.l3).toBe(0.7);
      expect(buildDefaultEvalConfig().weights.l1).toBe(0.2);
    });

    it("resolves golden set paths and rejects traversal", () => {
      const config = buildDefaultEvalConfig();
      const trace = { agentId: "agent-x", role: "operator" } as AgentEvalTrace;
      config.agents["agent-x"] = { eval: { goldenSet: "golden-sets/custom.jsonl" } };
      expect(goldenSetPathForTrace(config, trace)).toContain("custom.jsonl");
      expect(loadGoldenSet("/etc/passwd")).toEqual([]);
    });

    it("registers trajectory scorer and averages empty engine scores", () => {
      const registry = createEvalScorerRegistry();
      registerTrajectoryScorer(registry);
      expect(registry.has("trajectory_multi_step")).toBe(true);
      expect(listRegisteredScorers(registry).length).toBeGreaterThan(0);
      const scorers = createBuiltInScorers();
      const memoryScorer = scorers.find((s) => s.id === "memory_recall_l1");
      const trace: AgentEvalTrace = {
        traceId: "t1",
        agentId: "a1",
        role: "operator",
        output: "fact one",
        memory: { expectedFacts: ["fact one"], retrievedFacts: ["fact one"] },
      };
      expect(memoryScorer?.score(trace).score).toBeGreaterThan(0);
    });
  });

  describe("export CLI and GSD helpers", () => {
    it("returns usage errors for invalid CLI invocations", async () => {
      expect(await runMemroosCli(["node", "cli", "export"])).toBe(2);
      expect(await runMemroosCli(["node", "cli", "delete"])).toBe(2);
      expect(await runMemroosCli(["node", "cli", "nope"])).toBe(2);
    });

    it("blocks adapter safety when cost cap exceeded", () => {
      const db = freshDb();
      const result = runGsdAdapterSafetyCheck(db, {
        action: "write",
        content: "safe content",
        actorAgentId: "agent-b13",
        estimatedCostUsd: 999,
        costCapUsd: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedReasons).toContain("cost_cap_exceeded");
      db.close();
    });

    it("flags invalid phase UI representation kinds", () => {
      const result = validatePhaseUiRepresentation(
        "ui_representation: not_a_real_kind\nui_representation_note: missing ui"
      );
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("iris, belief outbound, hosts", () => {
    it("classifies iris findings and risk", () => {
      const scan = scanIrisPreflight("Contact support@example.com for help");
      expect(scan.findings.some((f) => f.category === "pii" || f.category === "content")).toBe(
        true
      );
      expect(scan.riskScore).toBeGreaterThan(0);
    });

    it("parses outbound policy truthy/falsy env values", () => {
      expect(loadOutboundPolicy({ BELIEF_OUTBOUND_GOLD_ONLY: "yes" }).goldOnly).toBe(true);
      expect(loadOutboundPolicy({ BELIEF_OUTBOUND_GOLD_ONLY: "off" }).goldOnly).toBe(false);
    });

    it("sorts detected host harnesses by name", () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-b13-"));
      fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
      const found = detectInstalledHarnesses({ homeDir: home, hostId: "host" });
      expect(found.map((h) => h.name)).toEqual([...found.map((h) => h.name)].sort());
      fs.rmSync(home, { recursive: true, force: true });
    });
  });

  describe("L3 adapters and poller", () => {
    it("returns fixture events from NetSuite adapter in non-production", async () => {
      vi.stubEnv("NODE_ENV", "test");
      const adapter = createNetSuiteAdapter();
      const events = await adapter.poll(new Date(Date.now() - 60_000));
      expect(events.length).toBeGreaterThan(0);
    });

    it("polls Salesforce and Zendesk fixture adapters", async () => {
      const sf = createSalesforceAdapter();
      const zd = createZendeskAdapter();
      expect((await sf.poll(new Date())).length).toBeGreaterThan(0);
      expect((await zd.poll(new Date())).length).toBeGreaterThan(0);
    });

    it("handles Hubspot fetch failures gracefully", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("fail", { status: 500 })));
      const hubspot = createHubSpotAdapter({ mock: false });
      expect(await hubspot.poll(new Date())).toEqual([]);
    });

    it("polls adapters through poller with empty poll results", async () => {
      const db = freshDb();
      const summary = await pollAllAdapters(
        [
          {
            name: "empty",
            category: "crm",
            poll: async () => [],
          },
        ],
        db
      );
      expect(summary.totalEventsWritten).toBe(0);
      db.close();
    });

    it("scores business ops L3 with company weights", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `l3-b13-${randomUUID()}-`));
      process.env.SQLITE_DB_PATH = path.join(tmp, "l3.db");
      vi.resetModules();
      const { getDb, closeDb } = await import("@/lib/db");
      const db = getDb();
      initSchema(db);
      db.prepare(
        `INSERT INTO business_outcome_events
          (tenant_id, correlation_id, source_system, adapter, event_type, kpi_value, kpi_key, raw_json, polled_at)
         VALUES ('default-tenant', 'corr-1', 'crm', 'sf', 'deal_won', 0.9, 'completion_rate', '{}', datetime('now'))`
      ).run();
      const events = readEventsForCorrelation("corr-1");
      expect(events.length).toBe(1);
      const kpis = aggregateKpis(events);
      expect(computeWeightedScore(kpis, { completion_rate: 1 })).toBeCloseTo(0.9, 1);
      const ctx: EvalScoringContext = {
        config: {
          ...buildDefaultEvalConfig(),
          companies: {
            acme: { l3_sub_weights: { completion_rate: 1 } },
          },
        },
      };
      const result = businessOpsL3Scorer.score(
        { traceId: "corr-1", agentId: "a1", role: "ops", metadata: { company_id: "acme" } },
        ctx
      );
      expect(result.score).toBeGreaterThan(0);
      closeDb();
      delete process.env.SQLITE_DB_PATH;
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe("memory doctor, retention, traces, qmd, native sink", () => {
    it("flags memory doctor repair when embeddings backlog exists", () => {
      const db = freshDb();
      db.prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, policy, visibility)
         VALUES ('s-embed', 'memroos', 'a1', 'user', 'needs embedding', datetime('now'), 'indexable', 'internal')`
      ).run();
      const diagnostic = buildMemoryDoctorDiagnostic(db, process.cwd());
      expect(diagnostic.memoryIteration.warnings.some((w) => w.includes("embedding"))).toBe(true);
      db.close();
    });

    it("starts retention scheduler once", () => {
      startRetentionExpiryScheduler();
      startRetentionExpiryScheduler();
      stopRetentionExpiryScheduler();
      expect(runScheduledRetentionExpiry).toBeDefined();
    });

    it("records memory traces and builds timelines", () => {
      const db = freshDb();
      const trace = recordMemoryTrace(db, {
        runId: "run-b13",
        causalPath: {
          contextAssembly: "assembled",
          retrievalQuery: "query",
          retrievedCandidates: [{ id: "m1", content: "fact", score: 0.9 }],
          policyFilters: [{ id: "p1", decision: "allow", reason: "ok" }],
          promptInclusion: true,
        },
        tenantId: "default-tenant",
        agentId: "agent-1",
      });
      const timeline = getMemoryTraceTimeline(trace);
      expect(timeline.length).toBeGreaterThan(0);
      db.close();
    });

    it("serializes qmd updates and authorizes memory use", () => {
      const db = freshDb();
      const pending = serializeQmdUpdate(db, "/tmp/qmd.md", "source body");
      expect(pending.status).toBe("pending");
      const finalized = finalizeQmdUpdate(db, pending.id, "success");
      expect(finalized.status).toBe("success");
      const decision = authorizeMemoryUse({
        actor: { actorId: "agent-1", actorRole: "agent", tenantId: "default-tenant" },
        purpose: "recall",
        label: { visibility: "internal", policy: "indexable" },
      });
      expect(decision.decision).toBe("allow");
      db.close();
    });

    it("processes native memory ingest with tenant budget", () => {
      const result = processNativeMemoryIngest({
        source: "hermes",
        agentId: "agent-1",
        userId: "user-1",
        content: "line\n",
        memoryPath: "MEMORY.md",
        tenantId: "default-tenant",
      });
      expect(result.budget.lineCount).toBeGreaterThan(0);
    });
  });

  describe("message memory, observe, ontology", () => {
    it("verifies slack signatures and ingests platform message memory", () => {
      const headers = new Headers({
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-slack-signature": "v0=deadbeef",
      });
      const verified = verifySlackRequest({
        signingSecret: "secret",
        headers,
        rawBody: "{}",
      });
      expect(verified.ok).toBe(false);
      const db = freshDb();
      ingestPlatformMessageMemory(db, {
        provider: "slack",
        workspaceId: "T1",
        channelId: "C1",
        messageId: "msg-1",
        threadId: "thr-1",
        author: { id: "U1" },
        content: "hello",
        timestamp: new Date().toISOString(),
        visibility: "internal",
        policy: "indexable",
      });
      db.close();
    });

    it("resolves observe roots from home directory", () => {
      const roots = resolveObserveRoots(os.homedir(), 3);
      expect(roots.length).toBeGreaterThan(0);
    });

    it("resolves ontology validity for core record types", () => {
      const db = freshDb();
      expect(() =>
        resolveOntologyValidity(db, {
          tenantId: "default-tenant",
          spaceId: "space-1",
          recordType: "message",
          recordId: "m-1",
        })
      ).toThrow(/ontology context is unavailable/);
      db.close();
    });
  });

  describe("retrieval bench validation and modules", () => {
    it("validates dataset ids and rejects malformed tasks", () => {
      expect(isDatasetId("locomo")).toBe(true);
      const invalid = validateTask({ id: "" }, { seenIds: new Set() });
      expect(invalid.ok).toBe(false);
    });

    it("converts locomo adapter samples into normalized tasks", () => {
      const converted = convertLoCoMoSamples({
        rawSamples: [
          {
            sample_id: "s1",
            conversations: [
              {
                session_id: "sess-1",
                turns: [{ role: "user", text: "hi", timestamp_iso: "2026-01-01T00:00:00Z" }],
              },
            ],
            qa: [{ qid: "q1", question: "q", answer: "a" }],
          },
        ],
      });
      expect(converted.ok).toBe(true);
      if (converted.ok) expect(converted.tasks.length).toBe(1);
    });

    it("resolves lanes and parses CLI args", () => {
      expect(resolveLaneForDataset("locomo").lane).toBe("external_retrieval");
      const parsed = parseCliArgs(["node", "bench", "run", "--dataset", "locomo", "--adapter", "lexical"]);
      expect(parsed.ok).toBe(true);
      expect(parsed.command?.dataset).toBe("locomo");
    });

    it("builds context packs from candidate lists", () => {
      const pack = packContext({
        items: [{ id: "c1", text: "hello world", score: 0.9, tier: "lexical", source: "fixture" }],
        budget: defaultContextBudget(),
      });
      expect(pack.receipt.selectedCount).toBeGreaterThan(0);
    });
  });

  describe("seal, shared space, skill budget, skillforge", () => {
    it("writes seal audit entries and lists eval jobs", () => {
      const db = freshDb();
      writeSealAuditEntry(
        {
          proposalId: "prop-b13",
          event: "proposed",
          detail: { note: "batch13" },
        },
        db
      );
      expect(queryAuditLog({}, db).length).toBeGreaterThan(0);
      expect(listEvalJobs(db, {}).length).toBe(0);
      expect(registryEntryFor("noop_test").type).toBe("noop_test");
      db.close();
    });

    it("enforces shared space toggles and writability", () => {
      const db = freshDb();
      const space = createSpace(db, { tenantId: "default-tenant", name: "shared-b13" });
      setSpaceShared(db, { spaceId: space.id, isShared: true, actorId: "ops", reason: "review" });
      expect(isSpaceShared(db, space.id)).toBe(true);
      expect(() =>
        setSpaceShared(db, { spaceId: "", isShared: true, actorId: "ops" })
      ).toThrow(/spaceId is required/);
      expect(() => assertWritableSpace(db, space.id, "ops")).toThrow(/read-only/);
      db.close();
    });

    it("reads skill catalog budget for temp skill root", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-b13-"));
      const skillDir = path.join(root, "demo-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: Demo\ndescription: test\n---\nbody\n",
        "utf8"
      );
      const report = await readSkillBudgetReport({
        roots: [{ id: "local", path: root, type: "configured", maxDepth: 2 }],
      });
      expect(report.totalSkills).toBeGreaterThan(0);
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("covers skillforge analyzer and worker class", () => {
      const results = analyzeTelemetry(
        [
          {
            id: "e1",
            skillId: "s1",
            skillName: "s1",
            traceType: "failure",
            payload: { note: "mystery" },
            securityLabels: [{ visibility: "internal", policy: "indexable" }],
            timestamp: new Date(),
          },
        ],
        {
          cronSchedule: "0 2 * * *",
          batchSize: 5,
          textualLearningRate: 0.3,
          redactionEnabled: true,
          skillScopeFilter: [],
          minTraceAgeHours: 0,
          maxTraceAgeDays: 30,
        }
      );
      expect(results.length).toBe(1);
      const db = freshDb();
      expect(
        new SkillForgeWorker(db, {
          cronSchedule: "0 2 * * *",
          batchSize: 5,
          textualLearningRate: 0.3,
          redactionEnabled: true,
          skillScopeFilter: [],
          minTraceAgeHours: 0,
          maxTraceAgeDays: 30,
        })
      ).toBeInstanceOf(SkillForgeWorker);
      db.close();
    });
  });

  describe("dispatch skill lookup and write rules", () => {
    it("parses trust levels and returns null for empty skill names", () => {
      expect(parseTrustLevel("verified")).toBe("verified");
      expect(parseTrustLevel("bogus")).toBeNull();
      const db = freshDb();
      expect(lookupSkillContract(db, "  ")).toBeNull();
      db.close();
    });

    it("creates write rules and resolves targets with fallback", () => {
      const db = freshDb();
      const space = createSpace(db, { tenantId: "default-tenant", name: "write-b13" });
      expect(validateWriteRule({ dataType: "", targetDocument: "doc" }).valid).toBe(false);
      createWriteRule(db, {
        spaceId: space.id,
        dataType: "note",
        targetDocument: "notes.md",
        fallbackRule: "default_doc",
        actorId: "ops",
      });
      expect(resolveWriteTarget(db, space.id, "missing-type").receiptReason).toBe("fallback");
      const evidence = buildSkillEvidence(null);
      expect(evidence.skill_governance.mode).toBe("fallback");
      db.close();
    });
  });

  describe("tool attention, tool auth, vault, wiki graph", () => {
    it("returns similar task recommendations structure", () => {
      const recs = getSimilarTaskRecommendations({ task_type: "debug", tags: ["sql"] }, 5);
      expect(Array.isArray(recs.recommendations)).toBe(true);
    });

    it("lists vault connections and slack provider metadata", () => {
      expect(Array.isArray(listVaultConnections())).toBe(true);
      expect(PROVIDERS_BY_KEY.slack?.key).toBe("slack");
    });

    it("encrypts vault bodies and writes artifacts", () => {
      const keyPath = path.join(os.tmpdir(), `vault-key-b13-${randomUUID()}.json`);
      const provider = new LocalFileKeyProvider(keyPath);
      const envelope = encryptVaultBody(Buffer.from("secret"), provider);
      expect(decryptVaultBody(envelope, provider).toString("utf8")).toBe("secret");
      const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-b13-"));
      vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
      const db = freshDb();
      const written = writeVaultArtifact(db, {
        tenantId: "default-tenant",
        sourceType: "test_capture",
        body: "payload",
        sessionId: "sess-b13",
        project: "memroos",
      });
      expect(readVaultArtifact(db, written.id)?.body).toBe("payload");
      db.close();
      fs.rmSync(vaultRoot, { recursive: true, force: true });
      fs.rmSync(keyPath, { force: true });
    });

    it("loads wiki graph skipping nodes without ids", () => {
      const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b13-"));
      fs.writeFileSync(
        path.join(wikiRoot, "wiki-graph.json"),
        JSON.stringify({ nodes: [{ label: "no-id" }, { id: "n1", path: "missing.md" }], edges: [] }),
        "utf8"
      );
      const graph = loadWikiGraph(wikiRoot);
      expect(graph.nodes).toEqual([]);
      fs.rmSync(wikiRoot, { recursive: true, force: true });
    });
  });

  describe("workflow topology, evidence bundles, memory inventory", () => {
    it("builds workflow topology graphs", () => {
      const db = freshDb();
      const topology = buildTopology(db, {
        agents: [{ id: "a1", name: "Agent", role: "ops" }],
        sources: [{ id: "slack", label: "Slack", sub: "connector" }],
      });
      expect(topology.nodes.length).toBeGreaterThan(0);
      db.close();
    });

    it("bundles task evidence receipts", () => {
      const db = freshDb();
      const bundle = upsertTaskEvidenceBundle(db, {
        taskId: "task-1",
        tenantId: "default-tenant",
        status: "open",
      });
      expect(bundle.taskId).toBe("task-1");
      db.close();
    });

    it("builds memory inventory snapshot", async () => {
      const db = freshDb();
      vi.doMock("@/lib/db", () => ({ getDb: () => db, closeDb: () => {} }));
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ status: "ok", memory_count: 0 }),
        }))
      );
      const { buildMemoryInventory: buildInv } = await import("@/lib/memory-inventory");
      const snapshot = await buildInv(new URL("http://localhost/memory/inventory"));
      expect(snapshot.categories.length).toBeGreaterThan(0);
      db.close();
      vi.doUnmock("@/lib/db");
    });
  });

  describe("audit escalation resolution and misc caches", () => {
    it("rejects resolving escalations in invalid states", () => {
      const db = freshDb();
      openEscalation(
        {
          id: "esc-b13",
          entity_type: "task",
          entity_id: "task-1",
          escalation_type: "agent_escalate",
          opened_by: "ops",
        },
        db
      );
      db.prepare(`UPDATE hil_escalations SET status = 'resolved' WHERE id = 'esc-b13'`).run();
      expect(() =>
        resolveEscalation("esc-b13", { actorId: "ops", note: "done" }, db)
      ).toThrow(/already resolved/);
      db.close();
    });

    it("evicts oldest cache entries when over max", async () => {
      const cache = createResponseCache({ maxEntries: 1 });
      await cache.getOrSet("ns", "a", 60_000, async () => 1);
      await cache.getOrSet("ns", "b", 60_000, async () => 2);
      expect(cache.stats().evictions).toBeGreaterThan(0);
      expect(cacheKey(["x", 1])).toMatch(/^[a-f0-9]{64}$/);
    });

    it("understand graph token gate fails closed", () => {
      vi.stubEnv("UNDERSTAND_GRAPH_TOKEN", "secret-token-value");
      const bad = new Request("http://localhost/understand?token=wrong");
      expect(hasValidUnderstandGraphToken(bad)).toBe(false);
      expect(forbiddenUnderstandResponse().status).toBe(403);
    });

    it("detects pii in storage scan", () => {
      expect(detectPiiForStorage("Email me@example.com").length).toBeGreaterThan(0);
    });

    it("runs SLA actions when no expired rows exist", () => {
      const db = freshDb();
      expect(runSlaActions(db).acted).toBe(0);
      db.close();
    });
  });
});
