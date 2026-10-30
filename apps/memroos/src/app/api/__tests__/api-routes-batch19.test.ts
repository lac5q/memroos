// @vitest-environment node
import crypto from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { persistEvalRun } from "@/lib/evals/persistence";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgent = vi.fn();
const mockAuthenticateUser = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();
const mockEmbedText = vi.fn();
const mockIsAutoReadme = vi.fn();
const mockSetAutoReadme = vi.fn();
const mockClassifyLiveness = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  };
});

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/embeddings/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embeddings/provider")>();
  return {
    ...actual,
    embedText: (...args: unknown[]) => mockEmbedText(...args),
  };
});

vi.mock("@/lib/artifact-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/artifact-gate")>();
  return {
    ...actual,
    isAutoReadmeUpdateEnabled: (...args: unknown[]) => mockIsAutoReadme(...args),
    setAutoReadmeUpdate: (...args: unknown[]) => mockSetAutoReadme(...args),
  };
});

vi.mock("@/lib/agent-liveness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-liveness")>();
  return {
    ...actual,
    classifyLiveness: (...args: unknown[]) => mockClassifyLiveness(...args),
  };
});

const LOOPBACK = "http://localhost";
const SLACK_SECRET = "batch19-slack-signing-secret";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signedSlackRequest(body: unknown, secret = SLACK_SECRET): Request {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${crypto
    .createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
  return new Request(`${LOOPBACK}/api/integrations/slack/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body: rawBody,
  });
}

function insertMessage(
  overrides: Partial<{
    session_id: string;
    project: string;
    agent_id: string;
    content: string;
    visibility: string;
    policy: string;
  }> = {},
) {
  testDb
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?, ?, ?, 'user', ?, '2026-06-01T00:00:00.000Z', ?, ?)`,
    )
    .run(
      overrides.session_id ?? `sess-${randomUUID().slice(0, 8)}`,
      overrides.project ?? "default",
      overrides.agent_id ?? "agent-a",
      overrides.content ?? "batch19 recall marker",
      overrides.visibility ?? "public_approved",
      overrides.policy ?? "indexable",
    );
}

function seedEvalRun(runId: string, traceId: string) {
  persistEvalRun(testDb, {
    id: runId,
    traceId,
    agentId: "agent-mem",
    role: "ops",
    compositeW: 0.55,
    trusted: true,
    layers: {
      l1: { score: 0.55, weight: 0.2, scorers: [] },
      l2: { score: 0.55, weight: 0.5, scorers: [] },
      l3: { score: 0.55, weight: 0.3, scorers: [] },
    },
    scorerResults: [],
    judge: {
      score: 0.55,
      rubricScores: { faithful: 0.55, useful: 0.55, policy: 0.55 },
      model: "judge",
      provider: "local",
      modelFamily: "local",
      promptTemplateVersion: "v1",
      promptHash: "hash",
      positionBiasMitigation: { swapAugmentation: true, orderAgreement: true },
    },
    driftGuard: {
      status: "passed",
      agreement: 1,
      floor: 0.85,
      goldenSetVersion: "golden",
      examples: [],
    },
    configHash: "config",
    goldenSetPath: "./golden.jsonl",
    startedAt: "2026-05-15T00:00:00.000Z",
    completedAt: "2026-05-15T00:00:01.000Z",
  });
}

function seedOperatorUser(userId: string) {
  testDb
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, password_hash, tenant_id)
       VALUES (?, ?, ?, 'hash', 'default-tenant')`,
    )
    .run(userId, `${userId}@test.com`, userId);
  testDb.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'operator')`).run(userId);
}

function seedOpenEscalation(id: string) {
  const now = new Date().toISOString();
  testDb
    .prepare(
      `INSERT INTO hil_escalations(
         id, tenant_id, entity_type, entity_id, escalation_type,
         sla_seconds, sla_deadline, status, opened_by, created_at
       ) VALUES (?, 'default-tenant', 'task', 'task-1', 'agent_escalate', 3600, ?, 'open', 'system', ?)`,
    )
    .run(id, new Date(Date.now() + 3600_000).toISOString(), now);
}

beforeEach(() => {
  mockAuthenticateAgent.mockReset();
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  mockAuthenticateUser.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  mockEmbedText.mockReset();
  mockEmbedText.mockResolvedValue({ embedding: [0.1, 0.2], degraded: false });
  mockIsAutoReadme.mockReset();
  mockIsAutoReadme.mockReturnValue(false);
  mockSetAutoReadme.mockReset();
  mockClassifyLiveness.mockReset();
  delete process.env.PAPERCLIP_BASE_URL;
  delete process.env.SLACK_SIGNING_SECRET;
  delete process.env.MEMROOS_SLACK_SIGNING_SECRET;
  vi.resetModules();
});

describe("api routes batch19 — priority coverage gaps", () => {
  describe("artifact-gate auto-readme", () => {
    it("GET returns 500 when auto-readme lookup throws", async () => {
      mockIsAutoReadme.mockImplementation(() => {
        throw new Error("readme store offline");
      });
      const space = createSpace(testDb, { tenantId: "default-tenant", name: `b19-${randomUUID().slice(0, 6)}` });
      const { GET } = await import("../artifact-gate/auto-readme/route");
      const res = await GET(asReq(`${LOOPBACK}/api/artifact-gate/auto-readme?spaceId=${space.id}&agent=agent-1`));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("readme store offline");
    });

    it("POST returns 400 for blank spaceId and when toggle persistence throws", async () => {
      const { POST } = await import("../artifact-gate/auto-readme/route");
      const missingSpace = await POST(
        jsonBody(`${LOOPBACK}/api/artifact-gate/auto-readme`, {
          spaceId: "   ",
          agent: "agent-1",
          enabled: true,
        }) as NextRequest,
      );
      expect(missingSpace.status).toBe(400);

      mockSetAutoReadme.mockImplementation(() => {
        throw new Error("toggle write failed");
      });
      const space = createSpace(testDb, { tenantId: "default-tenant", name: `b19-post-${randomUUID().slice(0, 6)}` });
      const failed = await POST(
        jsonBody(`${LOOPBACK}/api/artifact-gate/auto-readme`, {
          spaceId: space.id,
          agent: "agent-1",
          enabled: false,
        }) as NextRequest,
      );
      expect(failed.status).toBe(400);
      expect((await failed.json()).error).toBe("toggle write failed");
    });
  });

  describe("paperclip GET branches", () => {
    it("marks fleet degraded for upstream error agents and normalizes unknown statuses", async () => {
      process.env.PAPERCLIP_BASE_URL = "http://paperclip-upstream.test";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              agents: [
                { id: "err-1", name: "Err", status: "error", autonomyMode: "weird" },
                { id: "bad-1", name: "Bad", status: "unknown-status", autonomyMode: "HYBRID" },
              ],
            }),
            { status: 200 },
          ),
        ),
      );
      const { GET } = await import("../paperclip/route");
      const body = await (await GET()).json();
      expect(body.summary.fleetStatus).toBe("degraded");
      expect(body.agents.find((a: { id: string }) => a.id === "bad-1")?.status).toBe("idle");
      expect(body.agents.find((a: { id: string }) => a.id === "bad-1")?.autonomyMode).toBe("Hybrid");
      vi.unstubAllGlobals();
    });

    it("ignores upstream payloads when status is not ok", async () => {
      process.env.PAPERCLIP_BASE_URL = "http://paperclip-upstream.test";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("upstream down", { status: 503 })),
      );
      const { GET } = await import("../paperclip/route");
      const body = await (await GET()).json();
      expect(body.summary.fleetStatus).toBe("offline");
      expect(body.agents).toEqual([]);
      vi.unstubAllGlobals();
    });
  });

  describe("slack events POST edge envelopes", () => {
    beforeEach(() => {
      process.env.SLACK_SIGNING_SECRET = SLACK_SECRET;
    });

    it("rejects signed non-object JSON and missing url_verification challenges", async () => {
      const { POST } = await import("../integrations/slack/events/route");
      const arrayBody = await POST(signedSlackRequest("[]"));
      expect(arrayBody.status).toBe(400);
      expect((await arrayBody.json()).error).toBe("invalid JSON body");

      const missingChallenge = await POST(
        signedSlackRequest({ type: "url_verification", challenge: "" }),
      );
      expect(missingChallenge.status).toBe(400);
      expect((await missingChallenge.json()).error).toBe("missing Slack challenge");
    });

    it("ignores unsupported envelope types and unsupported Slack events", async () => {
      const { POST } = await import("../integrations/slack/events/route");
      const envelope = await POST(signedSlackRequest({ type: "app_mention" }));
      expect(envelope.status).toBe(200);
      expect(await envelope.json()).toMatchObject({
        ok: true,
        ignored: true,
        reason: "unsupported_envelope_type",
      });

      const unsupportedEvent = await POST(
        signedSlackRequest({
          type: "event_callback",
          team_id: "T123",
          event: { type: "reaction_added", item: { type: "message" } },
        }),
      );
      expect(unsupportedEvent.status).toBe(200);
      expect(await unsupportedEvent.json()).toMatchObject({
        ok: true,
        ignored: true,
        reason: "unsupported_event",
      });
    });
  });

  describe("time-series windows and parser branches", () => {
    let jsonlRoot: string;

    beforeEach(() => {
      jsonlRoot = mkdtempSync(path.join(tmpdir(), `ts-batch19-${randomUUID()}-`));
    });

    afterEach(() => {
      rmSync(jsonlRoot, { recursive: true, force: true });
    });

    it("returns collection_growth for week window and tolerates malformed JSONL lines", async () => {
      testDb
        .prepare(
          `INSERT INTO ingest_meta(file_path, mtime_ms, file_size, row_count, ingested_at)
           VALUES (?, ?, ?, ?, datetime('now', '-2 days'))`,
        )
        .run(`/tmp/b19-${randomUUID()}.md`, Date.now(), 128, 1);
      const { GET } = await import("../time-series/route");
      const growth = await GET(asReq(`${LOOPBACK}/api/time-series?metric=collection_growth&window=week`));
      expect(growth.status).toBe(200);
      expect((await growth.json()).metric).toBe("collection_growth");

      writeFileSync(
        path.join(jsonlRoot, "failures.log"),
        `{"timestamp":"${new Date().toISOString()}","event":"ok"}\n{broken-json\n`,
      );
      vi.doMock("@/lib/constants", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@/lib/constants")>();
        return {
          ...actual,
          FAILURES_LOG: path.join(jsonlRoot, "failures.log"),
          SKILL_CONTRIBUTIONS_LOG: path.join(jsonlRoot, "missing-skills.log"),
        };
      });
      vi.resetModules();
      const { GET: getWithLogs } = await import("../time-series/route");
      const failures = await getWithLogs(asReq(`${LOOPBACK}/api/time-series?metric=skill_failures&window=month`));
      expect(failures.status).toBe(200);
      expect(Array.isArray((await failures.json()).points)).toBe(true);
      vi.doUnmock("@/lib/constants");
    });

    it("returns 500 when time-series query throws unexpectedly", async () => {
      const origPrepare = testDb.prepare.bind(testDb);
      testDb.prepare = vi.fn((sql: string) => {
        if (typeof sql === "string" && sql.includes("recall_log")) {
          throw new Error("recall_log offline");
        }
        return origPrepare(sql);
      }) as typeof testDb.prepare;
      const { GET } = await import("../time-series/route");
      const res = await GET(asReq(`${LOOPBACK}/api/time-series?metric=recall_queries&window=day`));
      expect(res.status).toBe(500);
      testDb.prepare = origPrepare;
    });
  });

  describe("agents/[id] liveness envelope branches", () => {
    it("maps error and empty heartbeat statuses from classifyLiveness", async () => {
      const agentId = `agent-b19-${randomUUID().slice(0, 8)}`;
      testDb
        .prepare(
          `INSERT INTO registered_agents(id, name, role, platform, protocol, status, created_at, updated_at)
           VALUES (?, 'Batch19', 'test', 'codex', 'rest', 'idle', datetime('now'), datetime('now'))`,
        )
        .run(agentId);

      mockClassifyLiveness.mockReturnValueOnce({
        state: "error",
        observedAt: "2026-01-01T00:00:00.000Z",
        freshnessMs: null,
        source: "sqlite://registered_agents.last_heartbeat_at",
        reason: "parse failure",
      });
      const { GET } = await import("../agents/[id]/route");
      const errorRes = await GET(asReq(`${LOOPBACK}/api/agents/${agentId}`), {
        params: Promise.resolve({ id: agentId }),
      } as never);
      expect((await errorRes.json()).liveness.heartbeat.status).toBe("error");

      mockClassifyLiveness.mockReturnValueOnce({
        state: "never",
        observedAt: null,
        freshnessMs: null,
        source: "sqlite://registered_agents.last_heartbeat_at",
        reason: "never seen",
      });
      const emptyRes = await GET(asReq(`${LOOPBACK}/api/agents/${agentId}`), {
        params: Promise.resolve({ id: agentId }),
      } as never);
      expect((await emptyRes.json()).liveness.heartbeat.status).toBe("empty");
    });
  });

  describe("recall cross-project and agent filters", () => {
    it("rejects empty allowlists and filters bm25/semantic results by agent_id", async () => {
      insertMessage({ agent_id: "keep-agent", content: "batch19 bm25 keep agent filter" });
      insertMessage({ agent_id: "drop-agent", content: "batch19 bm25 drop agent filter" });

      const { GET } = await import("../recall/route");
      const emptyAllow = await GET(
        asReq(`${LOOPBACK}/api/recall?q=test&crossProject=true&allowed_project_ids=,%20`),
      );
      expect(emptyAllow.status).toBe(400);

      mockAuthorizeRegistryWrite.mockReturnValue(false);
      const bm25 = await GET(
        asReq(`${LOOPBACK}/api/recall?q=batch19+bm25&agent_id=keep-agent&mode=bm25`),
      );
      const bm25Body = await bm25.json();
      expect(bm25Body.results.every((r: { agent_id: string }) => r.agent_id === "keep-agent")).toBe(true);

      mockEmbedText.mockResolvedValue({ embedding: [0.5], degraded: false });
      const semantic = await GET(
        asReq(`${LOOPBACK}/api/recall?q=batch19+bm25&agent_id=keep-agent&mode=semantic`),
      );
      const semanticBody = await semantic.json();
      expect(semanticBody.mode).toBe("semantic");
      expect(semanticBody.results.every((r: { agent_id: string }) => r.agent_id === "keep-agent")).toBe(true);
    });
  });

  describe("memory proposals POST validation", () => {
    it("rejects invalid proposalTypes and trace/run mismatches", async () => {
      seedEvalRun("run-b19-a", "trace-a");
      const { POST } = await import("../memory/proposals/route");
      const invalidTypes = await POST(
        jsonBody(`${LOOPBACK}/api/memory/proposals`, {
          traceId: "trace-a",
          runId: "run-b19-a",
          proposalTypes: ["not_a_memory_type"],
        }) as NextRequest,
      );
      expect(invalidTypes.status).toBe(400);

      const mismatch = await POST(
        jsonBody(`${LOOPBACK}/api/memory/proposals`, {
          traceId: "trace-other",
          runId: "run-b19-a",
          proposalTypes: ["memory_rewrite"],
        }) as NextRequest,
      );
      expect(mismatch.status).toBe(400);
      expect((await mismatch.json()).error).toMatch(/does not belong to trace/);
    });
  });

  describe("escalations resolve route", () => {
    it("resolves open escalations and returns 409 when already resolved", async () => {
      seedOperatorUser("op-b19");
      mockAuthenticateUser.mockResolvedValue({
        userId: "op-b19",
        role: "operator",
        email: "op@example.com",
        displayName: "Op",
        tenantId: "default-tenant",
      });
      const openId = `esc-open-${randomUUID().slice(0, 8)}`;
      const resolvedId = `esc-done-${randomUUID().slice(0, 8)}`;
      seedOpenEscalation(openId);
      seedOpenEscalation(resolvedId);
      testDb.prepare(`UPDATE hil_escalations SET status = 'resolved' WHERE id = ?`).run(resolvedId);

      const { POST } = await import("../escalations/[id]/resolve/route");
      const ok = await POST(jsonBody(`${LOOPBACK}/api/escalations/${openId}/resolve`, { note: "done" }) as NextRequest, {
        params: Promise.resolve({ id: openId }),
      } as never);
      expect(ok.status).toBe(200);
      expect((await ok.json()).escalation.status).toBe("resolved");

      const conflict = await POST(
        new Request(`${LOOPBACK}/api/escalations/${resolvedId}/resolve`, { method: "POST" }) as NextRequest,
        { params: Promise.resolve({ id: resolvedId }) } as never,
      );
      expect(conflict.status).toBe(409);
    });
  });

  describe("classification review decision errors", () => {
    it("returns 400 for invalid JSON and 404 when review is missing", async () => {
      mockAuthenticateUser.mockResolvedValue({
        userId: "reviewer-b19",
        role: "reviewer",
        email: "rev@example.com",
        displayName: "Reviewer",
        tenantId: "default-tenant",
      });
      const { POST } = await import("../classification/reviews/[reviewId]/decision/route");
      const badJson = await POST(
        new Request(`${LOOPBACK}/api/classification/reviews/r-b19/decision`, {
          method: "POST",
          body: "{",
        }) as NextRequest,
        { params: Promise.resolve({ reviewId: "r-b19" }) } as never,
      );
      expect(badJson.status).toBe(400);
      expect((await badJson.json()).error).toBe("invalid json body");

      const missing = await POST(
        jsonBody(`${LOOPBACK}/api/classification/reviews/${randomUUID()}/decision`, {
          decision: "approve",
        }) as NextRequest,
        { params: Promise.resolve({ reviewId: randomUUID() }) } as never,
      );
      expect(missing.status).toBe(404);
    });
  });

  describe("agent-memory traces error handling", () => {
    it("POST returns 400 when trace capture fails", async () => {
      const { POST } = await import("../agent-memory/traces/route");
      const badPost = await POST(
        jsonBody(`${LOOPBACK}/api/agent-memory/traces`, { taskId: "missing-run" }) as Request,
      );
      expect(badPost.status).toBe(400);
      expect((await badPost.json()).status).toBe("error");
    });

    it("GET returns 500 when timeline building throws", async () => {
      vi.doMock("@/lib/memory-trace-observability", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@/lib/memory-trace-observability")>();
        return {
          ...actual,
          getMemoryTrace: vi.fn(() => ({
            id: "trace-b19",
            tenantId: "default-tenant",
            taskId: "task-b19",
            agentId: null,
            runId: "run-b19",
            causalPath: { retrievalQuery: "batch19" },
            failureClassification: null,
            rootCause: null,
            replayHandle: null,
            proposedRepair: null,
            createdAt: new Date().toISOString(),
          })),
          getMemoryTraceTimeline: vi.fn(() => {
            throw new Error("timeline builder offline");
          }),
        };
      });
      vi.resetModules();
      const { GET } = await import("../agent-memory/traces/route");
      const failedGet = await GET(new Request(`${LOOPBACK}/api/agent-memory/traces?runId=run-b19`));
      expect(failedGet.status).toBe(500);
      expect((await failedGet.json()).message).toBe("timeline builder offline");
      vi.doUnmock("@/lib/memory-trace-observability");
      vi.resetModules();
    });
  });
});
