// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { registerAgent } from "@/lib/agent-registry";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  };
});

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/knowledge-collections", () => ({
  loadCollections: vi.fn(() => [
    { name: "docs", category: "internal" as const, path: "/tmp/docs" },
    { name: "broken", category: "internal" as const, path: "/tmp/missing" },
  ]),
  resolveCollectionPaths: vi.fn((col: { name: string }) =>
    col.name === "broken" ? [] : ["/tmp/docs"],
  ),
  scanConfiguredCollection: vi.fn(async (col: { name: string }) => {
    if (col.name === "broken") throw new Error("scan failed for broken collection");
    return { docCount: 3, lastUpdated: new Date("2026-01-02T00:00:00.000Z") };
  }),
  collectCollectionFiles: vi.fn(async () => []),
}));

vi.mock("@/lib/memory/backends", () => ({
  checkGraphHealth: vi.fn(async () => ({ status: "degraded", backend: "neo4j", detail: "offline" })),
  mem0HealthTimeoutMs: () => 1000,
  searchVectorMemory: vi.fn(async () => []),
}));

const LOOPBACK = "http://localhost";

const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("long-tail batch16c — API routes", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue(null);
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    vi.unstubAllEnvs();
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_AGENT_API_KEY;
  });

  it("GET /api/health marks mem0 degraded when vector store is disconnected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          vector_store: "disconnected",
          queue: { queued: 2 },
        }),
      })),
    );
    const { GET } = await import("../health/route");
    const body = await (await GET()).json();
    const mem0 = body.services.find((s: { service: string }) => s.service === "mem0");
    expect(mem0?.status).toBe("degraded");
    expect(mem0?.detail).toMatch(/queued|vector store/i);
  });

  it("GET /api/health reports graph memory as down when neo4j is degraded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "ok", vector_store: "connected" }),
      })),
    );
    const { GET } = await import("../health/route");
    const body = await (await GET()).json();
    const graph = body.services.find((s: { service: string }) => s.service === "Graph Memory");
    expect(graph?.status).toBe("down");
  });

  it("GET /api/knowledge surfaces scan errors as metric error envelopes", async () => {
    const { GET } = await import("../knowledge/route");
    const body = await (await GET()).json();
    const broken = body.collections.find((c: { name: string }) => c.name === "broken");
    expect(broken.metric.status).toBe("error");
    expect(broken.metric.reason).toMatch(/scan failed/i);
  });

  it("GET /api/time-series returns skill_failures buckets from JSONL parser", async () => {
    const logDir = mkdtempSync(path.join(tmpdir(), "fail-log-b16c-"));
    const logPath = path.join(logDir, "failures.jsonl");
    writeFileSync(logPath, `${JSON.stringify({ timestamp: new Date().toISOString() })}\n`);
    vi.doMock("@/lib/constants", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/constants")>();
      return { ...actual, FAILURES_LOG: logPath, SKILL_CONTRIBUTIONS_LOG: logPath };
    });
    vi.resetModules();
    const { GET } = await import("../time-series/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/time-series?metric=skill_failures&window=day`))).json();
    expect(body.metric).toBe("skill_failures");
    expect(Array.isArray(body.points)).toBe(true);
    rmSync(logDir, { recursive: true, force: true });
  });

  it("GET /api/time-series returns memory_writes buckets from consolidation runs", async () => {
    testDb
      .prepare(
        `INSERT INTO memory_consolidation_runs (status, insights_written, started_at, completed_at)
         VALUES ('completed', 2, datetime('now'), datetime('now'))`,
      )
      .run();
    const { GET } = await import("../time-series/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/time-series?metric=memory_writes&window=day`))).json();
    expect(body.metric).toBe("memory_writes");
    expect(Array.isArray(body.points)).toBe(true);
  });

  it("GET /api/wiki status view reports missing wiki root safely", async () => {
    const wikiRoot = mkdtempSync(path.join(tmpdir(), "wiki-route-b16c-"));
    rmSync(wikiRoot, { recursive: true, force: true });
    const { GET } = await import("../wiki/route");
    const res = await GET(asReq(`${LOOPBACK}/api/wiki?view=status&knowledgeBasePath=${wikiRoot}`));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.exists).toBe(false);
  });

  it("GET /api/wiki returns empty tree when wiki root is absent", async () => {
    const missing = path.join(tmpdir(), `missing-wiki-${randomUUID()}`);
    const { GET } = await import("../wiki/route");
    const body = await (
      await GET(asReq(`${LOOPBACK}/api/wiki?view=tree&knowledgeBasePath=${missing}`))
    ).json();
    expect(body.exists).toBe(false);
    expect(body.tree).toEqual([]);
  });

  it("POST /api/paperclip/activity rejects invalid actorType", async () => {
    const { POST } = await import("../paperclip/activity/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/paperclip/activity`, {
        companyId: "co-1",
        actorType: "bot",
        actorId: "a1",
        action: "update",
        entityType: "issue",
        entityId: "1",
        timestamp: new Date().toISOString(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/paperclip/activity ingests a valid event into audit_entries", async () => {
    const { POST } = await import("../paperclip/activity/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/paperclip/activity`, {
        companyId: "co-1",
        actorType: "system",
        actorId: "paperclip",
        action: "issue.updated",
        entityType: "issue",
        entityId: "42",
        timestamp: "2026-05-01T12:00:00.000Z",
        metadata: { api_key: "must-be-redacted", lane: "fleet" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const audit = testDb
      .prepare(`SELECT metadata_json FROM audit_entries WHERE id = ?`)
      .get(body.auditId) as { metadata_json: string };
    const meta = JSON.parse(audit.metadata_json) as Record<string, unknown>;
    expect(meta.api_key).toBeUndefined();
    expect(meta.lane).toBe("fleet");
  });

  it("POST /api/memory/add rejects unauthenticated agents", async () => {
    mockAuthenticateAgent.mockReturnValue(null);
    const { POST } = await import("../memory/add/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/memory/add`, { content: "hello" }));
    expect(res.status).toBe(401);
  });

  it("POST /api/memory/add rejects invalid JSON bodies", async () => {
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    const { POST } = await import("../memory/add/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory/add`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/sign requires registry write authorization", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../skills/sign/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/skills/sign`, { content: "---\nname: x\n---\n" }));
    expect(res.status).toBe(403);
  });

  it("GET /api/agents/[id] returns 404 for unknown agents", async () => {
    const { GET } = await import("../agents/[id]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/missing-agent`), {
      params: Promise.resolve({ id: "missing-agent" }),
    } as never);
    expect(res.status).toBe(404);
  });

  it("GET /api/agents/[id] returns liveness envelope for registered agents", async () => {
    registerAgent({
      id: "agent-batch16c",
      name: "Batch16c Agent",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    const { GET } = await import("../agents/[id]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/agent-batch16c`), {
      params: Promise.resolve({ id: "agent-batch16c" }),
    } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.id).toBe("agent-batch16c");
    expect(body.liveness.heartbeat.status).toBeDefined();
  });

  it("POST /api/policy/knowledge rejects caller-supplied ontologyContext", async () => {
    const { POST } = await import("../policy/knowledge/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/policy/knowledge`, {
        action: "read",
        ontologyContext: { ontologyId: "forged" },
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/caller-supplied ontology context/i);
  });

  it("POST /api/policy/knowledge requires action", async () => {
    const { POST } = await import("../policy/knowledge/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/policy/knowledge`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET /api/cache/stats returns response-cache metric envelopes", async () => {
    const { GET } = await import("../cache/stats/route");
    const body = await (await GET()).json();
    expect(body.metrics.entries.status).toBeDefined();
    expect(body.performance).toBeDefined();
  });

  it("GET /api/library/freshness requires authentication", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../library/freshness/route");
    const res = await GET(asReq(`${LOOPBACK}/api/library/freshness`));
    expect(res.status).toBe(401);
  });

  it("GET /api/library/freshness returns collection freshness for authed users", async () => {
    const { GET } = await import("../library/freshness/route");
    const res = await GET(asReq(`${LOOPBACK}/api/library/freshness`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.collections)).toBe(true);
    expect(body.qmd).toBeDefined();
  });

  it("POST /api/ontology rejects invalid JSON bodies", async () => {
    const { POST } = await import("../ontology/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/ontology`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/seal/proposals requires a user session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../seal/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/proposals`));
    expect(res.status).toBe(401);
  });

  it("GET /api/seal/proposals lists proposals for authed operators", async () => {
    const { GET } = await import("../seal/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/proposals?status=pending`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.proposals)).toBe(true);
  });

  it("POST /api/engagement/test returns agent engagement checks", async () => {
    const { POST } = await import("../engagement/test/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/engagement/test`, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("POST /api/ontology ensure_canonical action succeeds on loopback", async () => {
    const { POST } = await import("../ontology/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/ontology`, { action: "ensure_canonical", actor: "operator" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/dsar/export requires an admin session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(operatorSession);
    const { POST } = await import("../dsar/export/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/dsar/export`, { userId: "user-1" }) as never);
    expect(res.status).toBe(403);
  });

  it("GET /api/agent-checkpoints requires runId query parameter", async () => {
    const { GET } = await import("../agent-checkpoints/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-checkpoints`));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/runId/i);
  });

  it("POST /api/agent-checkpoints creates a checkpoint on loopback", async () => {
    const { POST } = await import("../agent-checkpoints/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/agent-checkpoints`, {
        runId: `run-${randomUUID()}`,
        ownerAgentId: "agent-1",
        objective: "batch16c checkpoint",
        completedSteps: ["setup"],
        remainingSteps: ["verify"],
        decisions: {},
        verificationState: {},
        nextSafeAction: "continue",
        provenancePointers: [],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("POST /api/skills/lifecycle rejects missing skill_id", async () => {
    const { POST } = await import("../skills/lifecycle/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/skills/lifecycle`, { action: "get" }));
    expect(res.status).toBe(400);
  });
});
